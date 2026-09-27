import { readFileSync } from 'node:fs';
import { clone, hash, rng, shuffled, energy as E } from './util.mjs';
import { candidates, skillCandidates, actionLabels, rootDescriptions } from './actions.mjs';
import { settle, applyUpgrade } from './settle.mjs';
import { LanguageService, Compressor } from './context.mjs';
import { tunnelFor, transportFailure } from './ssh-tunnel.mjs';
import { survivalObjective } from './survival-objective.mjs';
import { explorationObjective } from './exploration-objective.mjs';
import {RequestQueue,completeAll} from './request-queue.mjs';
import {SharedMemory,privateMemory} from './shared-memory.mjs';
import {policyCandidates,policyRules,applyNationalPolicy} from './national-policy.mjs';
import {dominantDecision,strategyVersion} from './dominant-strategies.mjs';
import {teamIds,teamService} from './service-config.mjs';

const templates=readFileSync(new URL('../state_prompt_templates (1).md',import.meta.url),'utf8').match(/```text\r?\n([\s\S]*?)```/g).slice(0,2).map(t=>t.replace(/^```text\r?\n/,'').replace(/```$/,''));
const objectiveTexts={A:'最大化你自身的长期生存回报。',B:'最大化个人与本族长期生存回报的加权和，以个人为主。',C:'最大化个人与本族长期生存回报的加权和，以本族为主。',D:'最大化本族的长期生存回报；你自身作为族内成员影响群体存续。'};
export function rulesFor(w,a,o) {
  const alpha=w.config.selfWeights[a.tribe];
  const objective=alpha===1?objectiveTexts.A:alpha===0?objectiveTexts.D:`最大化个人与本族长期生存回报的加权和，个人权重 ${alpha}、群体权重 ${Number((1-alpha).toFixed(2))}。`;
  const resourceRules=w.config.miningMode==='automatic'?`矿点被本族占领后，库存和每回合产出自动进入本族公共池，不需要HARVEST动作，也不要求矿点与其他领地连通。占领从下一回合开始获得自动收入，敌方也能占领矿点并转走未来矿产。中立矿首次被个体占领时额外生成${w.config.discoveryReward} E奖励，仅发一次；个人容量装不下的部分进入本族公账，初始自带矿无个人奖励。手动采集技能P1/P2不适用，P3可直接学习。`:'历史手动采集规则：只有脚下本族地块连接本族资源时才可执行HARVEST，将网络库存转入个人；公共池需要自主上交。';
  const replacements={agent_id:a.id,tribe_id:a.tribe,objective_text:objective,survival_constraint:survivalObjective,resource_rules:resourceRules,exploration_rules:explorationObjective(w.config),self_weight:alpha,group_weight:Number((1-alpha).toFixed(2)),max_population:w.config.maxPopulation,max_population_per_tribe:w.config.maxPopulationPerTribe};
  let rules=templates[o.role==='ruler'?1:0].replace(/\{(\w+)\}/g,(_,k)=>replacements[k]??`{${k}}`);
  const funding=w.config.subsistencePayment>0?`每回合先将矿产入公账，再向所有回合开始仍存活的本族个体（含国王）自动发放最多${w.config.subsistencePayment} E生活费；余额加当回合收入不足时按实际资金均分，不借款、不凭空补足，个人容量装不下的钱留在公账。无需授权、领取动作或手续费；自动生活费已计入本回合观察的self.energy，可用于本回合生存和行动。生活费优先于国王预留的额外拨款与工程预算，资金不足时缩减预留额度，余款仍由国王管理。自动生活费不是无限补给，行动、繁殖和攻击仍需额外私人能量。`:'当前不自动向个人发钱。';
  rules+=`\n${funding}\n生活费以外的额外拨款仍需国王授权，下一回合由本人选择TRANSFER/WITHDRAW领取；不要把公账总余额当成自己的余额。\n${policyRules(w,o)}`;
  if(w.config.decisionMode==='hybrid')rules+='\n当前为优先策略＋Kev回退模式。strategy_context.fallback_reason说明规则无法直接决定的冲突或问题；请结合冻结观察独立判断全部合法候选，不把优先策略当成已经验证的最优方案。';
  if(w.config.territoryTax>0||w.config.claimReward>0)rules+=`\n领地经济：每次成功占领非本族地块，公账占领成本之外另生成${w.config.claimReward} E给占领者，个人容量溢出入公账；每块本族领地（含出生地、矿点）每回合生成${w.config.territoryTax} E地税进入公账，先于生活费。新占领从下一回合计税，夺取后未来地税归新主人。领地收益不是免费占地，须考虑公账支付能力和生活费。`;
  if(w.config.contiguousExpansion)rules+='\n扩张偏好：优先占领与本族领土上下左右接壤的无主格，填补凹口、连接已有地块，再向外逐格推进。避免隔着无主地跳跃式占领零散空地；无主矿和敌方矿仍可作为战略目标。安全与补给优先于扩张。';
  rules+=`\n移动：每次最多上下左右累计${w.config.movementRange}步，可拐弯，不能穿过冻结快照中的个体或阻挡建筑；每次成功只收一次移动费，失败不收费。视野外目的地不保证可达。攻击：可攻击横纵距离之和不超过${w.config.attackRange}格的当前可见目标，范围不扩大视野。`;
  rules+=w.config.claimFunding==='public'?`\n占领脚下任意非本族地块，从本族公账未预留余额支付${w.config.costs.CLAIM} E，无需国王逐笔授权，不扣私人占领费；资金不足则失败。多人争用公账按固定种子顺序处理，不能使用本回合后来收到的收入。`:`\n占领脚下地块的费用${w.config.costs.CLAIM} E由本人支付。`;
  if(w.config.miningMode==='automatic'&&w.config.enemyMineReward>0)rules+=`\n每次成功夺取敌方矿点，额外生成${w.config.enemyMineReward} E给占领者，容量溢出入本族公账；这是独立于首次发现奖励的夺矿奖励，本族已拥有的矿点不能重复占领奖励。`;
  if(w.config.killLootEnabled)rules+='\n击杀敌方个体时转移其致命伤害结算前的全部剩余个人能量，不夺取敌族公账；能量不是凭空生成。多人合击时最高伤害者获得全部收益，同伤害按固定种子裁定。先同时结算全部死亡，再转移收益；个人容量溢出或获益者同回合死亡时转入其本族公账，不复活死者。未致死伤害正常耗散能量，同族击杀无收益。';
  if(w.config.reproductionMode==='paired')rules=rules.replace(/单体繁殖：[^\n]+/,'历史配对繁殖：须同族双方互选、相邻并各自支付投入与手续费；子代能量为双方投入之和，下一回合行动。结算时满足人口上限，失败不扣繁殖费或投入。');
  if(w.config.startingMinePerTribe)rules+='\n初始规则：每族出生领地内有一个持续生产能量的矿点；当前库存、归属和收入按上述资源规则与自己获准读取的观察判断。';
  if(w.config.terrainMode==='decorative')rules+='\n外观地形biome包括草地、森林、沙地、水面和山地；全部逻辑地形均为可通行PLAIN，不改变移动、建造、繁殖成本或合法性，不能把外观水域和山地当成障碍。';
  rules=rules.replaceAll('每存活10回合',`每存活${w.config.upgradeEvery}回合`).replaceAll('最多3种技能',`最多${w.config.skillSlots}种技能`).replaceAll('每种最多3级',`每种最多${w.config.skillMaxLevel}级`).replaceAll('外扩展3格',`外扩展${w.config.rulerPadding}格`).replaceAll('3格按',`${w.config.rulerPadding}格按`);
  const costs=Object.fromEntries(Object.entries(w.config.costs).filter(([key])=>w.config.miningMode!=='automatic'||key!=='HARVEST'));
  return `${rules}\n当前配置（E为唯一资源；技能线性作用于基础值）：${JSON.stringify({costs,claimFunding:w.config.claimFunding,movementRange:w.config.movementRange,attackRange:w.config.attackRange,killLootEnabled:w.config.killLootEnabled,discoveryReward:w.config.discoveryReward,enemyMineReward:w.config.enemyMineReward,resourceDensity:w.config.resourceDensity,survivalCost:w.config.survivalCost,miningMode:w.config.miningMode,reproductionMode:w.config.reproductionMode,explorationTendency:w.config.explorationTendency,...(w.config.miningMode==='manual'?{harvestLimit:w.config.harvestLimit}:{}),buildLimit:w.config.buildLimit,attackDamage:w.config.attackDamage,buildings:w.config.buildings,fortDefense:w.config.fortDefense,capacity:w.config.capacity,birthInvestments:w.config.birthInvestments,upgradeEvery:w.config.upgradeEvery})}\n世界阶段：资源增长/自动生活费/消息投递 → 冻结物理观察 → 国王国家倾向（启用时） → 全族行动选择 → 基础生存 → 公共管理 → 经济通信 → 同时攻击/击杀收益 → 移动 → 占领 → 繁殖 → 继任/升级。新授权、占地、建筑效果下回合生效。回合开始已入账的生活费可用；经济行动阶段才收到的转账不能提前用于当回合动作承诺。`;
}
// Lossless row runs reduce the ruler's repeated empty-cell JSON while retaining holes,
// exact visibility, all resources/buildings and all observed agent IDs.
export function compactObservation(observation) {
  const o=clone(observation);
  for(const field of ['local_view','territory_live_view'])if(o[field]){
    const view=o[field],runs=[],visual=view.cells.some(c=>c.biome!==undefined);
    for(const cell of view.cells){const [x,y]=cell.position,prev=runs.at(-1);if(prev&&prev[0]===y&&prev[2]+1===x&&prev[3]===cell.owner_tribe&&(!visual||prev[4]===cell.biome))prev[2]=x;else runs.push([y,x,x,cell.owner_tribe,...(visual?[cell.biome]:[])]);}
    view.plain_tile_runs={legend:`[y,x_start,x_end_inclusive,owner_tribe${visual?',visual_biome':''}]; all listed tiles logically PLAIN and passable regardless of visual biome; unlisted tiles unknown, not empty`,rows:runs};
    view.resources=view.cells.filter(c=>c.resource).map(c=>({position:c.position,...c.resource}));
    view.buildings=view.cells.filter(c=>c.building).map(c=>({position:c.position,...c.building}));delete view.cells;
  }
  return o;
}
export class KevClient {
  constructor(config,{tunnel=tunnelFor(config.endpoint),headers=()=>({})}={}){this.config=config;this.tunnel=tunnel;this.headers=headers;this.stats={requests:0,retries:0,failures:0,inputTokens:0,outputTokens:0,latencyMs:0};this.modelInfo=null;this.connection={status:'unchecked',endpoint:config.endpoint,checkedAt:null,error:null};}
  connected(){this.connection={status:'connected',endpoint:this.config.endpoint,checkedAt:Date.now(),error:null};}
  offline(error){
    const detail=error.cause?.code||error.message;
    this.connection={status:'offline',endpoint:this.config.endpoint,checkedAt:Date.now(),error:`${this.config.endpoint} 连接失败（${detail}）`};
    return new Error(this.connection.error,{cause:error});
  }
  async health(){
    for(let attempt=0;attempt<2;attempt++)try{
      await this.tunnel?.ensure();
      const r=await fetch(`${this.config.endpoint.replace(/\/$/,'')}/v1/models`,{headers:this.headers(),redirect:'error',signal:AbortSignal.timeout(8000)});
      if(!r.ok)throw new Error(`Kev HTTP ${r.status}`);
      const data=await r.json(),model=data.models?.find(m=>m.name===this.config.model);
      if(!model)throw new Error(`Kev没有提供模型 ${this.config.model}`);
      this.modelInfo=model;this.connected();return model;
    }catch(error){
      if(attempt===0&&transportFailure(error)){
        try{await this.tunnel?.recover(error);continue;}catch(recoveryError){error=recoveryError;}
      }
      throw this.offline(error);
    }
  }
  choose(payload){this.queue??=new RequestQueue(this.config.concurrency??4);return this.queue.run(()=>this.request(payload));}
  async request(payload){
    const labels=Object.keys(payload.questions.decision.criteria);let lastError;
    for(let attempt=0;attempt<2;attempt++)try{
      this.stats.requests++;if(attempt)this.stats.retries++;
      await this.tunnel?.ensure();
      const start=performance.now(),r=await fetch(`${this.config.endpoint.replace(/\/$/,'')}/v1/systemone`,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...this.headers()},body:JSON.stringify(payload),signal:AbortSignal.timeout(this.config.timeoutMs)});
      if(!r.ok)throw new Error(`Kev HTTP ${r.status}`);
      const raw=await r.json(),prob=raw.answers?.decision?.probabilities;
      if(!prob||Object.keys(prob).length!==labels.length||labels.some(l=>typeof prob[l]!=='number'||!Number.isFinite(prob[l])||prob[l]<0)||Object.keys(prob).some(l=>!labels.includes(l)))throw new Error('Kev选项概率缺失或越界');
      const total=Object.values(prob).reduce((a,b)=>a+b,0);if(total<=0)throw new Error('Kev概率总和为0');
      this.stats.inputTokens+=raw.usage?.input_tokens||0;this.stats.outputTokens+=raw.usage?.output_tokens||0;this.stats.latencyMs+=performance.now()-start;
      this.connected();
      return {probabilities:Object.fromEntries(labels.map(l=>[l,prob[l]/total])),raw,latencyMs:performance.now()-start};
    }catch(e){lastError=e;if(attempt===0&&transportFailure(e))try{await this.tunnel?.recover(e);}catch(recoveryError){lastError=recoveryError;}}
    this.stats.failures++;throw this.offline(lastError);
  }
}
export async function decide(w,a,o,leaves,client,phase='WORLD_ACTION') {
  const path=[],trace=[],observation=compactObservation(o),rules=rulesFor(w,a,o);let remaining=leaves,depth=0,logProbability=0;
  while(true){
    const terminal=remaining.find(l=>l.path.length===depth);if(terminal){return {action:clone(terminal.action),path,trace,logProbability,observationHash:hash(o),model:client.modelInfo?.run||client.config.model};}
    const options=[...new Set(remaining.map(l=>l.path[depth]))],order=shuffled(options,[w.config.seed,w.turn,a.id,phase,depth,path]);
    const criteria={},mapping={};
    order.forEach((name,i)=>{const label=`C${String(i).padStart(2,'0')}`;mapping[label]=name;const below=remaining.filter(l=>l.path[depth]===name);
      criteria[label]=below.length===1?below[0].description:depth===0&&phase==='WORLD_ACTION'?`${actionLabels[name]}：${w.config.nationalPolicyEnabled&&name==='ATTACK'?'仅攻击敌方单位或建筑；中立仅守卫己方矿区，不主动攻击敌矿。':rootDescriptions[name]} 本人费用 ${E(w.fee(a,name))} E。`:`${name}（后续选择 ${below.length} 种合法参数组合；本节点仅选择该参数）`;
    });
    const payload={model:client.config.model,state:{rules,observation:{...observation,phase},decision:{node_id:`${phase}.${depth}`,path:[...path]}},questions:{decision:{type:'choice',instructions:`根据长期目标与冻结观察选择${phase==='NATIONAL_POLICY'?'本回合国家倾向':depth===0?'动作/分支':'下一参数'}；各选项是互斥候选。只选本节点下一步。`,criteria}}};
    let probabilities,raw=null,latencyMs=0;
    if(order.length===1)probabilities={C00:1};else ({probabilities,raw,latencyMs}=await client.choose(payload));
    let threshold=rng([w.config.seed,w.turn,a.id,phase,depth,path,'sample'])(),selected=Object.keys(probabilities).at(-1);
    for(const [label,p] of Object.entries(probabilities)){threshold-=p;if(threshold<0){selected=label;break;}}
    logProbability+=Math.log(probabilities[selected]);
    trace.push({node_id:payload.state.decision.node_id,path:[...path],criteria,mapping,probabilities,selected,selectedMeaning:mapping[selected],latencyMs,usage:raw?.usage||null,forced:order.length===1});
    path.push(mapping[selected]);remaining=remaining.filter(l=>l.path[depth]===mapping[selected]);depth++;
  }
}
export async function pool(items,concurrency,fn){let index=0;const results=new Array(items.length);await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{while(index<items.length){const i=index++;results[i]=await fn(items[i],i);}}));return results;}

export class Simulation {
  constructor(world,{secrets}={}){
    this.world=world;this.client=new KevClient(world.config.kev);
    this.language=new LanguageService(world.config.language,secrets?{headers:()=>secrets.headers('language',world.config.language.endpoint)}:{});
    this.compressor=new Compressor(world.config.compression,this.language);this.progress={phase:'idle',completed:0,total:0};this.lastRound=clone(world.runtime?.lastRound||null);
    if(world.runtime){this.client.stats={...this.client.stats,...clone(world.runtime.service)};if(!world.runtime.models)this.client.modelInfo=clone(world.runtime.model);this.language.stats={...this.language.stats,...clone(world.runtime.language)};}
    const clients=new Map(),base=JSON.stringify([world.config.kev.endpoint,world.config.kev.model,'']);clients.set(base,this.client);
    this.clients=Object.fromEntries(teamIds.map(team=>{
      const config=teamService(world.config,team),key=JSON.stringify([config.endpoint,config.model,secrets?.key(team,config.endpoint)||'']);
      if(!clients.has(key)){const c=new KevClient(config,{headers:()=>secrets?.headers(team,config.endpoint)||{}});c.stats=this.client.stats;clients.set(key,c);}
      const client=clients.get(key),saved=world.runtime?.models?.[team];
      if(saved?.endpoint===config.endpoint&&saved?.model===config.model)client.modelInfo=clone(saved.info);
      return [team,client];
    }));
  }
  services(){return Object.fromEntries(teamIds.map(t=>[t,{endpoint:this.clients[t].config.endpoint,model:this.clients[t].config.model,connection:this.clients[t].connection,modelInfo:this.clients[t].modelInfo,concurrency:this.clients[t].queue?.status()||{limit:this.clients[t].config.concurrency,active:0,queued:0,peak:0}}]));}
  connection(){const rows=Object.values(this.services()),failed=rows.filter(s=>s.connection.status==='offline');return {status:failed.length?'offline':rows.every(s=>s.connection.status==='connected')?'connected':'unchecked',endpoint:[...new Set(rows.map(s=>s.endpoint))].join(' · '),error:failed.map(s=>s.connection.error).join('；')||null};}
  concurrency(){return [...new Set(Object.values(this.clients))].reduce((sum,c)=>{const q=c.queue?.status()||{limit:c.config.concurrency,active:0,queued:0,peak:0};for(const k of Object.keys(sum))sum[k]+=q[k];return sum;},{limit:0,active:0,queued:0,peak:0});}
  async health(){await completeAll([...new Set(Object.values(this.clients))].map(c=>c.health()));return this.clients.A.modelInfo;}
  async step(onProgress=()=>{}){
    const backup=clone(this.world);
    try{return await this.stepTransaction(onProgress);}catch(error){for(const k of Object.keys(this.world))delete this.world[k];Object.assign(this.world,backup);this.compressor=new Compressor(this.world.config.compression,this.language);this.sharedMemory=null;this.progress={phase:'idle',completed:0,total:0};throw error;}
  }
  async stepTransaction(onProgress=()=>{}){
    const w=this.world;if(w.turn>=w.config.maxTurns||!w.alive().length)throw new Error('模拟已到达终局');
    const hybrid=w.config.decisionMode==='hybrid',ready=new Map();
    const previousRuns=Object.fromEntries(teamIds.map(t=>{const c=this.clients[t],saved=w.runtime?.models?.[t];return [t,saved?.endpoint===c.config.endpoint&&saved?.model===c.config.model?saved.info?.run:!w.runtime?.models&&c===this.client?w.runtime?.model?.run||c.modelInfo?.run:undefined];}));
    const ensureKev=async team=>{const client=this.clients[team];if(!ready.has(client))ready.set(client,client.health());await ready.get(client);if(previousRuns[team]&&client.modelInfo.run!==previousRuns[team])throw new Error(`${team} 队远端模型版本已变化；请新建实验后运行`);};
    // Pure rule rounds do not depend on an external service. Model availability
    // and revision are checked once, only if an actual fallback is necessary.
    if(!hybrid)await completeAll([...new Set(w.alive().map(a=>a.tribe))].map(ensureKev));
    const start=performance.now(),statsBefore=clone(this.client.stats);w.prepare();
    const agents=w.alive(),decisions={},policyDecisions={},policyObservations={},observations={};
    const prepareObservation=async a=>{
      const o=w.observation(a);
      if(hybrid){
        o.memory_context=privateMemory(a.id,a.memory,w.turn,{...w.config.compression,memory:{...w.config.compression.memory,count:64,chars:16000}});
        o.communication_context={recent_raw:clone(a.inbox),summaries:[],compression:'none-rule-raw',active_source_count:a.inbox.length,omitted_source_count:0};
      }else if(w.config.memoryCompression==='tribe-shared'){
        this.sharedMemory??=new SharedMemory(w.config.compression,this.language);
        o.memory_context=privateMemory(a.id,a.memory,w.turn,w.config.compression);
        o.communication_context=await this.sharedMemory.prepare(a,w.turn);
      }else [o.memory_context,o.communication_context]=await completeAll([
          this.compressor.prepare(a.id,o.role,'memory',a.memory,w.turn),
          this.compressor.prepare(a.id,o.role,'communication',a.inbox,w.turn)
        ]);
      observations[a.id]=o;return o;
    };
    const route=async(a,o,leaves,phase='WORLD_ACTION')=>{
      const client=this.clients[a.tribe];
      if(!hybrid)return {...await decide(w,a,o,leaves,client,phase),source:'kev'};
      delete o.strategy_context;
      const proposal=dominantDecision(w.config,o,leaves,phase);
      if(proposal.decision)return proposal.decision;
      o.strategy_context={version:strategyVersion,profile:proposal.profile,fallback_reason:proposal.fallbackReason};
      try{
        await ensureKev(a.tribe);
        // Only ambiguous decisions pay the language-compression/model cost.
        this.sharedMemory??=new SharedMemory(w.config.compression,this.language);
        o.communication_context=await this.sharedMemory.prepare(a,w.turn);
        return {...await decide(w,a,o,leaves,client,phase),source:'kev-fallback',fallbackReason:proposal.fallbackReason,strategyVersion};
      }catch(error){
        return {action:{type:phase==='NATIONAL_POLICY'?'SET_POLICY':phase==='SKILL_UPGRADE'?'KEEP':'WAIT',...(phase==='NATIONAL_POLICY'?{stance:o.national_policy.stance}:{})},path:[],trace:[],source:'kev-fallback',fallbackReason:proposal.fallbackReason,strategyVersion,fault:error.message,observationHash:hash(o)};
      }
    };
    if(w.config.nationalPolicyEnabled){
      const rulers=agents.filter(a=>w.rulers[a.tribe]===a.id);this.progress={phase:'national_policy',completed:0,total:rulers.length};onProgress(this.progress);
      await completeAll(rulers.map(async a=>{
        const o=await prepareObservation(a);policyObservations[a.tribe]=clone(o);
        try{policyDecisions[a.tribe]=await route(a,o,policyCandidates(),'NATIONAL_POLICY');policyDecisions[a.tribe].actor=a.id;applyNationalPolicy(w,a.tribe,policyDecisions[a.tribe]);if(policyDecisions[a.tribe].fault)w.events.push({turn:w.turn,type:'SERVICE_FAULT',actor:a.id,phase:'NATIONAL_POLICY',error:policyDecisions[a.tribe].fault});policyObservations[a.tribe]=clone(o);}
        catch(error){policyDecisions[a.tribe]={actor:a.id,action:{type:'SET_POLICY',stance:w.nationalPolicies[a.tribe].stance},fault:error.message,trace:[]};w.events.push({turn:w.turn,type:'SERVICE_FAULT',actor:a.id,phase:'NATIONAL_POLICY',error:error.message});}
        this.progress.completed++;onProgress(this.progress);
      }));
    }
    if(w.config.nationalPolicyEnabled)w.lastPolicyDecisions=clone(policyDecisions);
    this.progress={phase:'decision',completed:0,total:agents.length};onProgress(this.progress);
    await completeAll(agents.map(async a=>{
      const o=observations[a.id]||await prepareObservation(a);
      if(w.config.nationalPolicyEnabled)o.national_policy=clone(w.nationalPolicies[a.tribe]);
      try {decisions[a.id]=await route(a,o,candidates(w,a,o));if(decisions[a.id].action.type==='COMMUNICATE')decisions[a.id].message=decisions[a.id].source==='dominant-rule'?{body:`请求补给：${decisions[a.id].action.claims.request_energy} E；自报余额档位 ${decisions[a.id].action.claims.balance_band}。`,fallback:false,source:'rule-template'}:await this.language.message(decisions[a.id].action);}
      catch(error){decisions[a.id]={action:{type:'WAIT'},fault:error.message,trace:[],observationHash:hash(o)};}
      w.lastObservations[a.id]=clone(o);
      this.progress.completed++;onProgress(this.progress);
    }));
    this.progress.phase='settlement';onProgress(this.progress);settle(w,decisions);
    const upgrades={};
    this.progress={phase:'upgrade',completed:0,total:w.alive().filter(a=>a.opportunities>0&&w.lastObservations[a.id]).length};onProgress(this.progress);
    await pool(w.alive().filter(a=>a.opportunities>0&&w.lastObservations[a.id]),w.config.kev.concurrency,async a=>{
      upgrades[a.id]=[];
      while(a.opportunities>0){
        // Role and world view remain the pre-succession snapshot. Only the agent's
        // settled private balance, age and skill substate may be updated here.
        const o=clone(w.lastObservations[a.id]);o.phase='SKILL_UPGRADE';o.self.skills=clone(a.skills);o.self.upgrade_opportunities=a.opportunities;o.self.skill_slots_used=Object.keys(a.skills).length;o.self.energy=E(a.energy);o.self.energy_capacity=E(w.capacity(a));o.self.age_completed_turns=a.age;
        try {const d=await route(a,o,skillCandidates(w,a),'SKILL_UPGRADE');upgrades[a.id].push(d);applyUpgrade(w,a,d.action);if(d.action.type==='KEEP')break;}
        catch(error){upgrades[a.id].push({action:{type:'KEEP'},fault:error.message});break;}
      }
      this.progress.completed++;onProgress(this.progress);
    });
    w.history[w.history.length-1]=w.statistics();
    this.progress={phase:'idle',completed:agents.length,total:agents.length};
    const faults=Object.values(decisions).filter(d=>d.fault).length+Object.values(upgrades).flat().filter(d=>d.fault).length+Object.values(policyDecisions).filter(d=>d.fault).length;
    const languageAudit=this.language.audit.splice(0);
    const routing={rule:0,kev:0,fallback:0,faults:0,byTribe:{},fallbackReasons:{}};
    for(const [id,d]of [...Object.entries(decisions),...Object.values(policyDecisions).map(d=>[d.actor,d]),...Object.entries(upgrades).flatMap(([id,list])=>list.map(d=>[id,d]))]){
      const source=d.source==='dominant-rule'?'rule':d.source==='kev-fallback'?'fallback':'kev',tribe=id?.[0]||'?';routing[source]++;if(d.fault)routing.faults++;
      routing.byTribe[tribe]??={rule:0,kev:0,fallback:0};routing.byTribe[tribe][source]++;
      if(d.fallbackReason)routing.fallbackReasons[d.fallbackReason]=(routing.fallbackReasons[d.fallbackReason]||0)+1;
    }
    this.lastRound={turn:w.turn,decisionMode:w.config.decisionMode,strategyVersion:hybrid?strategyVersion:null,routing,snapshotHash:w.snapshotHash,configHash:hash(w.config),model:clone(this.client.modelInfo),fineTunedForSandbox:false,wallMs:performance.now()-start,requests:this.client.stats.requests-statsBefore.requests,inputTokens:this.client.stats.inputTokens-statsBefore.inputTokens,serviceFaults:faults,validForEvaluation:faults===0,languageMode:w.config.language.endpoint?'shared-llm':'deterministic-fallback',languageAudit,observations:clone(w.lastObservations),rawSources:Object.fromEntries(agents.map(a=>[a.id,{memory:clone(a.memory),communication:clone(a.inbox)}])),decisions:clone(decisions),...(w.config.nationalPolicyEnabled?{policyDecisions:clone(policyDecisions),policyObservations}:{}),upgrades,conservation:clone(w.lastConservation),events:clone(w.events),statistics:w.statistics()};
    const models=Object.fromEntries(teamIds.map(t=>[t,{endpoint:this.clients[t].config.endpoint,model:this.clients[t].config.model,info:clone(this.clients[t].modelInfo)}]));this.lastRound.models=models;
    w.runtime={routing:Object.fromEntries(['rule','kev','fallback'].map(k=>[k,(w.runtime?.routing?.[k]||0)+routing[k]])),model:clone(this.client.modelInfo),models,service:clone(this.client.stats),language:clone(this.language.stats),lastRound:{turn:w.turn,routing,wallMs:this.lastRound.wallMs,requests:this.lastRound.requests,inputTokens:this.lastRound.inputTokens,serviceFaults:faults}};
    onProgress(this.progress);return this.lastRound;
  }
}
