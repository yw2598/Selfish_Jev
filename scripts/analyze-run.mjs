import {createReadStream,readFileSync,writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import path from 'node:path';

// Read one completed round at a time; long runs contain large private observation logs.
const file=process.argv[2]||`artifacts/${JSON.parse(readFileSync('artifacts/100-turn-run.json','utf8')).episode}.jsonl`;
const prefix=process.argv[3]||file.replace(/\.jsonl$/,'-analysis');
const tribes=['A','B','C','D'],counts=()=>Object.fromEntries(tribes.map(t=>[t,{}]));
const add=(obj,key,n=1)=>obj[key]=(obj[key]||0)+n;
const sum=a=>a.reduce((a,b)=>a+b,0),round=n=>Number(n.toFixed(3));
let initial,config,model,owners=[],last,decisionCount=0,nonForced=0,topChoices=0;
const rounds=[],actions=counts(),outcomes=counts(),rootProbabilities=counts(),rootCounts=counts(),harvest={requests:0,success:0,empty:0,amount:0};
const cross={visibleObserverTurns:0,localObserverTurns:0,adjacentObserverTurns:0,firstVisibleTurn:null,firstAdjacentTurn:null,pairs:{},gifts:[],attacks:[],claims:[]};
const intra={gifts:[],attacks:[],allocations:[],withdrawals:[],fundingChains:[],messageFollowups:[]},communications=[],grants=new Map();
const language={successfulRequests:0,failedAttempts:0,fallbackRequests:0,errors:{},messageFallbacks:0,compressionSourceObservations:0,omittedSourceObservations:0,fallbackSummaryObservations:0,compressionRequests:0,messageRequests:0,privateSourceObservations:0,privateOmittedObservations:0};
const decisionsOfInterest=[],tribeOf=id=>id?.[0],pair=(a,b)=>`${a}->${b}`;
const previousDecisions=new Map(),deaths=[];
const nationalPolicy={choices:counts(),actionsByStance:{},switches:[],mineClaims:[],faults:0},previousPolicy={};
const subsistence={payments:0,amount:0,shortageTurns:[]};
const activity=[];
const routing={rule:0,kev:0,fallback:0,byPhase:{},fallbackReasons:{},ruleIds:{}};
let requestedTurns=100;
try{const run=JSON.parse(readFileSync('artifacts/100-turn-run.json','utf8'));if(run.episode===path.basename(file,'.jsonl'))requestedTurns=run.requestedTurns||100;}catch{}
for await(const line of createInterface({input:createReadStream(file),crlfDelay:Infinity})){
  if(!line.trim())continue;let r;try{r=JSON.parse(line);}catch{continue;}
  if(r.kind==='INITIAL'){initial=r;config=r.config;owners=r.scenario?.owners?Object.fromEntries(r.scenario.owners):{};continue;}
  if(r.kind!=='ROUND')continue;
  last=r;model=r.model;
  const choices=Object.values(r.decisions);activity.push({turn:r.turn,decisions:choices.length,waits:choices.filter(d=>d.action.type==='WAIT').length,forcedWaits:choices.filter(d=>d.action.type==='WAIT'&&(d.trace?.[0]?.forced||d.ruleId==='only-option')).length});
  for(const [phase,decisions]of Object.entries({world:choices,policy:Object.values(r.policyDecisions||{}),upgrade:Object.values(r.upgrades||{}).flat()})){
    routing.byPhase[phase]??={rule:0,kev:0,fallback:0};
    for(const d of decisions){const source=d.source==='dominant-rule'?'rule':d.source==='kev-fallback'?'fallback':'kev';routing[source]++;routing.byPhase[phase][source]++;if(d.fallbackReason)add(routing.fallbackReasons,d.fallbackReason);if(d.ruleId)add(routing.ruleIds,d.ruleId);}
  }
  for(const [tribe,d]of Object.entries(r.policyDecisions||{})){if(d.fault){nationalPolicy.faults++;continue;}add(nationalPolicy.choices[tribe],d.action.stance);if(previousPolicy[tribe]&&previousPolicy[tribe]!==d.action.stance)nationalPolicy.switches.push({turn:r.turn,tribe,from:previousPolicy[tribe],to:d.action.stance});previousPolicy[tribe]=d.action.stance;}
  for(const e of r.events.filter(e=>e.type==='SUBSISTENCE')){if(e.amount>0)subsistence.payments++;subsistence.amount+=e.amount;}
  for(const t of r.statistics.tribes)if((t.lastSubsistencePaid||0)<(t.lastSubsistenceDemand||0))subsistence.shortageTurns.push({turn:r.turn,tribe:t.tribe,paid:t.lastSubsistencePaid,demand:t.lastSubsistenceDemand});
  for(const event of r.events.filter(e=>e.type==='DEATH')){
    const previous=previousDecisions.get(event.actor),observation=r.observations[event.actor];
    deaths.push({turn:r.turn,actor:event.actor,cause:event.cause,startEnergy:observation?.self.energy,previous,
      afterOutgoingTransfer:previous?.turn===r.turn-1&&previous.action.type==='TRANSFER'&&['CONTRIBUTE','GIVE'].includes(previous.action.mode)&&previous.events.some(e=>e.type==='TRANSFER'&&e.result==='OK'&&e.amount>0)&&event.cause==='SURVIVAL'&&observation?.self.energy<=observation?.self.survival_cost_due,
      publicEnergy:r.statistics.tribes.find(t=>t.tribe===tribeOf(event.actor))?.publicEnergy});
  }
  rounds.push({turn:r.turn,wallSeconds:round(r.wallMs/1000),requests:r.requests,inputTokens:r.inputTokens,faults:r.serviceFaults,valid:r.validForEvaluation,conservation:r.conservation,statistics:r.statistics});
  for(const entry of r.languageAudit||[]){if(entry.error){language.failedAttempts++;if(entry.attempt===1)language.fallbackRequests++;add(language.errors,entry.error);}else {language.successfulRequests++;if(entry.task?.task==='COMPRESS_CONTEXT')language.compressionRequests++;if(entry.task?.task==='GENERATE_MESSAGE')language.messageRequests++;}}
  for(const [id,o] of Object.entries(r.observations)){
    // lastObservations also retains deceased agents for inspection, not decisions.
    if(!r.decisions[id])continue;
    const tribe=o.self.tribe_id,local=(o.local_view?.observed_agents||[]).filter(a=>a.tribe_id!==tribe),visible=[...new Map([...(o.territory_live_view?.observed_agents||[]),...local].filter(a=>a.tribe_id!==tribe).map(a=>[a.id,a])).values()];
    if(visible.length){cross.visibleObserverTurns++;cross.firstVisibleTurn??=r.turn;}
    if(local.length)cross.localObserverTurns++;
    const adjacent=local.filter(a=>Math.abs(a.position[0]-o.self.position[0])+Math.abs(a.position[1]-o.self.position[1])<=1);
    if(adjacent.length){cross.adjacentObserverTurns++;cross.firstAdjacentTurn??=r.turn;}
    for(const enemy of visible){const key=pair(tribe,enemy.tribe_id);cross.pairs[key]??={seen:0,adjacent:0};cross.pairs[key].seen++;if(adjacent.some(a=>a.id===enemy.id))cross.pairs[key].adjacent++;}
    for(const c of [o.memory_context,o.communication_context])if(c){if(c.compression==='none-private-raw'){language.privateSourceObservations+=c.active_source_count||0;language.privateOmittedObservations+=c.omitted_source_count||0;continue;}language.compressionSourceObservations+=c.active_source_count||0;language.omittedSourceObservations+=c.omitted_source_count||0;language.fallbackSummaryObservations+=(c.summaries||[]).filter(s=>s.excerpt_fallback).length;}
    const d=r.decisions[id];if(!d)continue;decisionCount++;add(actions[tribe],d.action.type);
    const stance=o.national_policy?.stance;if(stance){nationalPolicy.actionsByStance[stance]??={};add(nationalPolicy.actionsByStance[stance],d.action.type);}
    previousDecisions.set(id,{turn:r.turn,startEnergy:o.self.energy,action:d.action,events:r.events.filter(e=>e.actor===id&&e.result)});
    const root=d.trace?.[0];if(root){for(const [label,p] of Object.entries(root.probabilities)){const action=root.mapping[label];add(rootProbabilities[tribe],action,p);add(rootCounts[tribe],action);}if(!root.forced){nonForced++;if(root.probabilities[root.selected]>=Math.max(...Object.values(root.probabilities))-1e-9)topChoices++;}}
    if(d.action.type==='COMMUNICATE'){communications.push({turn:r.turn,actor:id,tribe,intent:d.action.intent,claims:d.action.claims,body:d.message?.body,fallback:d.message?.fallback});if(d.message?.fallback)language.messageFallbacks++;}
    if(o.self.energy<=15&&decisionsOfInterest.length<60)decisionsOfInterest.push({turn:r.turn,actor:id,energy:o.self.energy,action:d.action,root:root?Object.fromEntries(Object.entries(root.probabilities).map(([k,p])=>[root.mapping[k],round(p)])):null});
  }
  for(const e of r.events){
    const d=r.decisions[e.actor],a=d?.action,tribe=tribeOf(e.actor);if(!tribes.includes(tribe))continue;
    if(e.result)add(outcomes[tribe],`${e.type}:${e.result}`);
    if(e.type==='HARVEST'){harvest.requests++;if(e.result==='OK')harvest.success++;if(e.result==='NO_YIELD')harvest.empty++;harvest.amount+=e.amount||0;}
    if(e.result!=='OK')continue;
    if(e.type==='TRANSFER'&&a?.mode==='GIVE'){
      const item={turn:r.turn,actor:e.actor,target:e.target,amount:e.amount,source:d.source||'kev',stance:r.observations[e.actor]?.national_policy?.stance};(tribe===tribeOf(e.target)?intra.gifts:cross.gifts).push(item);
    }
    if(e.type==='ATTACK'&&typeof e.target==='string'){
      const item={turn:r.turn,actor:e.actor,target:e.target,nominalDamage:e.damage,source:d.source||'kev',stance:r.observations[e.actor]?.national_policy?.stance};(tribe===tribeOf(e.target)?intra.attacks:cross.attacks).push(item);
    }
    if(e.type==='CLAIM'){
      const cell=r.observations[e.actor]?.local_view?.cells?.find(c=>JSON.stringify(c.position)===JSON.stringify(e.position));if(cell?.resource)nationalPolicy.mineClaims.push({turn:r.turn,actor:e.actor,stance:r.observations[e.actor]?.national_policy?.stance,position:e.position,previous:cell.owner_tribe??null,source:d.source||'kev',reward:e.capture_reward??e.discovery_reward??0});
      const p=e.position[1]*config.width+e.position[0],previous=owners[p];if(previous&&previous!==tribe)cross.claims.push({turn:r.turn,actor:e.actor,previous,position:e.position});owners[p]=tribe;
    }
    if(e.type==='TREASURY'&&a?.mode==='ALLOCATE_MEMBER'){
      const item={turn:r.turn,actor:e.actor,target:a.member,amount:a.amount/100,grant:`${tribe}:T${r.turn}:ALLOCATE_MEMBER`};intra.allocations.push(item);grants.set(item.grant,item);
    }
    if(e.type==='TRANSFER'&&a?.mode==='WITHDRAW'){
      const item={turn:r.turn,actor:e.actor,grant:a.grant,amount:e.amount};intra.withdrawals.push(item);if(grants.has(a.grant))intra.fundingChains.push({allocation:grants.get(a.grant),withdrawal:item});
    }
    const target=a?.mode==='GIVE'?a.target:a?.mode==='ALLOCATE_MEMBER'?a.member:null;
    if(target){
      const o=r.observations[e.actor],sources=o?.communication_context?.recent_raw||[];
      for(const msg of communications.filter(m=>m.actor===target&&m.intent==='ENERGY_REQUEST'&&m.turn<r.turn&&r.turn-m.turn<=config.communicationTTL)){
        const messageId=`M${msg.turn}:${msg.actor}`;
        const visible=sources.some(s=>s.message_id===messageId)||(o?.communication_context?.summaries||[]).some(s=>s.sender_ids?.includes(target)&&s.source_ids.some(id=>id.includes(messageId)));
        if(visible)intra.messageFollowups.push({message:msg,response:{turn:r.turn,actor:e.actor,target,action:a.mode,amount:(e.amount??a.amount/100)},interpretation:'消息可见后发生的关联行为；未做移除消息的因果对照'});
      }
    }
  }
}
if(!last)throw new Error('No completed round yet');
const latencies=rounds.map(r=>r.wallSeconds).sort((a,b)=>a-b),totalTurns=last.turn;
const perTribe=last.statistics.tribes.map(t=>({...t,peakPopulation:Math.max(config.population,...rounds.map(r=>r.statistics.tribes.find(x=>x.tribe===t.tribe).population)),actions:actions[t.tribe],outcomes:outcomes[t.tribe],meanRootProbabilityWhenAvailable:Object.fromEntries(Object.entries(rootProbabilities[t.tribe]).map(([action,total])=>[action,round(total/rootCounts[t.tribe][action])]))}));
const result={file,episode:path.basename(file,'.jsonl'),analyzedAt:new Date().toISOString(),config,model,turns:totalTurns,requestedTurns,endedEarly:totalTurns<requestedTurns&&perTribe.every(t=>t.population===0),validForEvaluation:rounds.every(r=>r.valid),decisionCount,selection:{nonForced,topChoiceRate:nonForced?round(topChoices/nonForced):null},timing:{totalSeconds:round(sum(latencies)),medianSeconds:latencies[Math.floor(latencies.length/2)],p95Seconds:latencies[Math.min(latencies.length-1,Math.ceil(latencies.length*.95)-1)],maxSeconds:latencies.at(-1)},service:{requests:sum(rounds.map(r=>r.requests)),faults:sum(rounds.map(r=>r.faults)),inputTokens:sum(rounds.map(r=>r.inputTokens)),maxAbsoluteConservationError:Math.max(...rounds.map(r=>Math.abs(r.conservation.error)))},perTribe,harvest,language,cross,intra,communications,decisionsOfInterest,rounds};
result.invalidTurns=rounds.filter(r=>!r.valid).map(r=>r.turn);result.deaths=deaths;result.nationalPolicy=nationalPolicy;result.subsistence=subsistence;result.activity=activity;
result.routing=routing;
try{
  const saved=JSON.parse(readFileSync('artifacts/latest.checkpoint.json','utf8'));
  if(saved.episode===result.episode&&saved.world.turn===totalTurns){const w=saved.world;result.energyBreakdown={private:sum(Object.values(w.agents).map(a=>a.energy))/100,public:sum(Object.values(w.accounts))/100,mines:sum(Object.values(w.resources).map(r=>r.stock))/100,buildings:sum(Object.values(w.buildings).map(b=>b.energy))/100};result.mineStocks=Object.entries(w.resources).map(([p,r])=>({position:[Number(p)%config.width,Math.floor(Number(p)/config.width)],tribe:w.owners[p],stock:r.stock/100,capacity:r.capacity/100,production:r.production/100}));}
}catch{}
writeFileSync(`${prefix}.json`,JSON.stringify(result,null,2));
const cols=['turn','tribe','nationalPolicy','population','energy','publicEnergy','territory','controlledResources','effectiveProduction','births','deaths','personTurns','harvested','automaticIncome','territoryIncome','claimBonus','subsistencePaid','lastSubsistencePaid','lastSubsistenceDemand','discoveryBonus','captureBonus','killLoot','contributed','withdrawn','buildInvested','communicationCost'];
writeFileSync(`${prefix}.csv`,cols.join(',')+'\n'+rounds.flatMap(r=>r.statistics.tribes.map(t=>cols.map(k=>k==='turn'?r.turn:t[k]).join(','))).join('\n'));
const lines=[`# ${requestedTurns}回合观察：${config.decisionMode==='hybrid'?'四组策略 + Kev 冲突回退':'Kev-0.8B'} + Qwen3.8 Flash`,'',...(result.invalidTurns.length?[`**运行含故障或干预回合：${result.invalidTurns.join(', ')}。以下为含回退行为的实际轨迹，不能当作全程无故障的策略评测。**`,'']:[]),`实验：\`${result.episode}\`；已完成 ${totalTurns}/${requestedTurns} 回合${result.endedEarly?'，全部灭绝提前终止':''}。种子 ${config.seed}，${config.width}×${config.height}，四族各${config.population}人起始，每族领地1矿，${config.resourceProduction} E/回合。繁殖：${config.reproductionMode}；矿产：${config.miningMode}；探索：${config.explorationTendency}；压缩：${config.memoryCompression}。`, '',`Kev：\`${model?.run||'未调用Kev（规则决策）'}\`；语言：\`${config.language.model}\`。未做沙盘微调。`, '', '| 族群 | 存活/峰值 | 出生/死亡 | 私人E | 公共池E | 领土 | 矿产入账/生活费/首占奖励E | 上交/领取E | 灭绝回合 |','|---|---:|---:|---:|---:|---:|---:|---:|---:|',...perTribe.map(t=>`| ${t.tribe} | ${t.population}/${t.peakPopulation} | ${t.births}/${t.deaths} | ${t.energy} | ${t.publicEnergy} | ${t.territory} | ${round(t.automaticIncome||0)}/${round(t.subsistencePaid||0)}/${round(t.discoveryBonus||0)} | ${round(t.contributed)}/${round(t.withdrawn)} | ${t.extinctTurn??'—'} |`),'','## 联动与决策', '',`跨族可见个体回合 ${cross.visibleObserverTurns}，局部可见个体回合 ${cross.localObserverTurns}，相邻个体回合 ${cross.adjacentObserverTurns}；首次可见/相邻回合：${cross.firstVisibleTurn??'无'}/${cross.firstAdjacentTurn??'无'}。重复观察计入这些曝光指标，不能视为独立事件。`, '',`跨族赠予 ${cross.gifts.length} 次、${round(sum(cross.gifts.map(e=>e.amount)))} E；跨族攻击 ${cross.attacks.length} 次；夺取敌方地块 ${cross.claims.length} 次。`, '',`族内赠予 ${intra.gifts.length} 次、攻击 ${intra.attacks.length} 次；统治者成功授权 ${intra.allocations.length} 次，领取 ${intra.withdrawals.length} 次，其中 ${intra.fundingChains.length} 次可追溯至记录中的授权。看到能量请求后向发送者赠予/授权的关联记录 ${intra.messageFollowups.length} 条，仅表示时间和信息上的关联，不证明消息导致了行动。`, '',`同族广播 ${communications.length} 次；规则不包含跨族广播或联盟协议。Kev动作根节点非强制选择 ${nonForced} 次，其中选择最大概率选项的比例 ${round(100*(result.selection.topChoiceRate||0))}%；Kev采用固定种子概率采样，规则决策不计入该概率统计。`, '', '## 服务与统计边界','',`Kev ${result.service.requests} 次请求、${result.service.faults} 个决策故障；能量守恒最大误差 ${result.service.maxAbsoluteConservationError} E。累计回合耗时 ${result.timing.totalSeconds} 秒，P95 ${result.timing.p95Seconds} 秒。`, '',`语言成功请求 ${language.successfulRequests}（共享压缩 ${language.compressionRequests}、通信正文 ${language.messageRequests}），失败尝试 ${language.failedAttempts}，通信正文回退 ${language.messageFallbacks}。摘要回退出现次数 ${language.fallbackSummaryObservations}（按决策观察重复计数），共享消息省略来源曝光 ${language.omittedSourceObservations}/${language.compressionSourceObservations}。私人原文窗口省略来源曝光 ${language.privateOmittedObservations}/${language.privateSourceObservations}，这些私人记录未调用LLM压缩；所有曝光数按个体和回合重复计数。`, '',`本次是一个种子、一个角落分配和一组模型采样轨迹。没有多种子、角落轮换或消息消融，不据此判定四种目标的普遍优劣。`, '',`详细事件、每族动作分布与根节点条件概率见 [JSON](${path.basename(prefix)}.json)，逐回合指标见 [CSV](${path.basename(prefix)}.csv)。`];
lines.push('','## 决策来源','',`当前模式：${config.decisionMode||'kev'}。包含个体行动、国家倾向及升级：规则 ${routing.rule} 次、纯Kev ${routing.kev} 次、冲突交由Kev ${routing.fallback} 次；一个模型决策可能需要多次候选树请求。混合策略的行为不能归因于纯模型目标权重。`,'',...Object.entries(routing.fallbackReasons).map(([reason,count])=>`- ${reason}：${count} 次。`));
lines.push('','## 死亡前的资金流','',`死亡 ${deaths.length} 人，其中 ${deaths.filter(d=>d.afterOutgoingTransfer).length} 人在前一回合上交或赠予后，下一回合因私人余额不足基础生存消耗死亡。`, '',...deaths.filter(d=>d.afterOutgoingTransfer).slice(0,5).map(d=>`- ${d.actor}：第${d.previous.turn}回合起始${d.previous.startEnergy} E，选择${d.previous.action.mode}，成功转出${sum(d.previous.events.filter(e=>e.type==='TRANSFER'&&e.result==='OK').map(e=>e.amount||0))} E；第${d.turn}回合仅剩${d.startEnergy} E并死亡，当时本族公共池${d.publicEnergy} E。`));
if(result.energyBreakdown)lines.push('',`当前能量分布：私人 ${round(result.energyBreakdown.private)} E、公共池 ${round(result.energyBreakdown.public)} E、矿库存 ${round(result.energyBreakdown.mines)} E、建筑 ${round(result.energyBreakdown.buildings)} E。每轮生活费按当轮配置自动发放给尚存活个体；已死亡者不会复活，额外公账资金仍需主动管理。`);
const tail=activity.slice(-20),tailTotal=sum(tail.map(t=>t.decisions));lines.push('','## 后期行动能力','',`最后${tail.length}回合共${tailTotal}次个体决策，其中等待${sum(tail.map(t=>t.waits))}次（${round(100*sum(tail.map(t=>t.waits))/Math.max(1,tailTotal))}%），因当前只有WAIT合法而等待${sum(tail.map(t=>t.forcedWaits))}次。自动生活费覆盖生存不等于支付了动作费用；此统计区分主动等待和无其他合法动作。`);
if(config.nationalPolicyEnabled)lines.push('','## 自动生活费与国家倾向','',`自动生活费累计 ${round(subsistence.amount)} E，共 ${subsistence.payments} 人次；资金不足的族群回合 ${subsistence.shortageTurns.length}。国家倾向选择失败 ${nationalPolicy.faults} 次，成功切换 ${nationalPolicy.switches.length} 次。`,'','| 族群 | 激进回合 | 保守回合 | 中立回合 |','|---|---:|---:|---:|',...tribes.map(t=>`| ${t} | ${nationalPolicy.choices[t].AGGRESSIVE||0} | ${nationalPolicy.choices[t].CONSERVATIVE||0} | ${nationalPolicy.choices[t].NEUTRAL||0} |`),'',`各模式实际占领矿点事件：${JSON.stringify(nationalPolicy.mineClaims)}。同族单位当回合共享本族国家倾向；指令改变候选限制和提示，不代表必定完成某个行动。`);
const neutralClaims=nationalPolicy.mineClaims.filter(e=>!e.previous),captures=nationalPolicy.mineClaims.filter(e=>e.previous&&e.previous!==tribeOf(e.actor));
lines.push('','## 矿点争夺与跨族行为','',`实际占领无主矿 ${neutralClaims.length} 次，其中中立 ${neutralClaims.filter(e=>e.stance==='NEUTRAL').length} 次、保守 ${neutralClaims.filter(e=>e.stance==='CONSERVATIVE').length} 次；夺取敌矿 ${captures.length} 次。普通敌方地块占领不计为夺矿。`,'',...captures.map(e=>`- T${e.turn}：${e.actor} 在 ${e.stance} 倾向下夺取 ${e.previous} 族矿点 (${e.position})，来源 ${e.source}，奖励 ${e.reward} E。`),'',...cross.gifts.slice(0,8).map(e=>`- T${e.turn}：${e.actor} 向 ${e.target} 赠予 ${e.amount} E，来源 ${e.source}。`),'',`跨族赠予表示实际资源转移，不能仅据此判断稳定联盟或互惠协议。死亡原因分布：${JSON.stringify(deaths.reduce((out,e)=>(out[e.cause]=(out[e.cause]||0)+1,out),{}))}。`);
writeFileSync(`${prefix}.md`,lines.join('\n'));
console.log(JSON.stringify({report:`${prefix}.md`,turn:totalTurns,tribes:perTribe.map(t=>({tribe:t.tribe,population:t.population,energy:t.energy,publicEnergy:t.publicEnergy,harvested:t.harvested,extinctTurn:t.extinctTurn})),service:result.service,cross:{seen:cross.visibleObserverTurns,adjacent:cross.adjacentObserverTurns,gifts:cross.gifts.length,attacks:cross.attacks.length},language}));
