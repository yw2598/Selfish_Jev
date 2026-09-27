import { units as U, energy as E } from './util.mjs';
import { availableSkills } from './world.mjs';
import {tacticalContext} from './national-policy.mjs';

export const actionLabels={WAIT:'等待',MOVE:'移动',ATTACK:'攻击',HARVEST:'采集',CLAIM:'占领',TRANSFER:'转移',COMMUNICATE:'通信',BUILD:'建造',REPRODUCE:'繁殖',TREASURY:'公共管理'};
const bands=['EMPTY','LOW','MID','HIGH'];
const fractions=n=>[...new Set([0.25,0.5,1].map(f=>Math.floor(n*f)))].filter(n=>n>0);
export function candidates(w,a,o) {
  const leaves=[],c=w.config,occupied=w.occupied||Object.fromEntries(w.alive().map(a=>[a.p,a.id])),tactics=tacticalContext(w,a,o);
  const add=(type,path,data={},description='')=>leaves.push({path:[type,...path],action:{type,...data},description:description||`${actionLabels[type]} ${path.join(' → ')}`});
  add('WAIT',[],{},`等待；只扣基础生存 ${E(w.survival(a))} E。`);
  if(a.energy<=w.survival(a)) return leaves;
  const fee=t=>E(w.fee(a,t));
  const amountDesc=(n,t,transferOut=false)=>`数量 ${E(n)} E；固定费用 ${fee(t)} E；支付基础与费用${transferOut?'及投入':''}后余额下界 ${E(a.energy-w.survival(a)-w.fee(a,t)-(transferOut?n:0))} E。`;
  if(w.canPay(a,'MOVE')) for(const [p,steps] of w.moveTargets(a,o)) {const [x,y]=w.xy(p),[ax,ay]=w.xy(a.p);const direction=y<ay?'N':x>ax?'E':y>ay?'S':'W';
    const distance=tactics?.enemies.length?` 距已可见敌方最近距离：${Math.min(...tactics.enemies.map(b=>w.distance(a.p,w.index(...b.position))))}→${Math.min(...tactics.enemies.map(b=>w.distance(p,w.index(...b.position))))}格。`:'';
    const tile=o.local_view.cells.find(c=>w.index(...c.position)===p),mine=tile?.resource?tile.owner_tribe===null?' 此格是可主动占领的无主矿。':tile.owner_tribe===a.tribe?' 此格是本族矿。':' 此格是敌方矿。':'';
    add('MOVE',c.movementRange===1?[direction]:[`${x},${y}`],{p},`移动到 (${x},${y})；上下左右路线 ${steps} 步，最多${c.movementRange}步，可拐弯；成功费 ${fee('MOVE')} E/次；未知地块可能阻挡，争格或路径失败只扣生存。${distance}${mine}`);
  }
  if(w.canPay(a,'CLAIM')&&w.owners[a.p]!==a.tribe&&(!w.buildings[a.p]||w.buildings[a.p].tribe===a.tribe)&&!(tactics?.stance==='NEUTRAL'&&tactics.enemyMine(a.p))) add('CLAIM',[],{p:a.p},`占领脚下 (${w.xy(a.p)})${w.resources[a.p]?' 的矿点':''}；${c.claimFunding==='public'?`从本族公账未预留余额支付 ${c.costs.CLAIM} E，公账不足则失败，不扣私人占领费`:`私人费 ${fee('CLAIM')} E`}；下一回合生效。${c.claimReward>0?`每次成功占地额外生成 ${c.claimReward} E给本人（溢出入公账）；每格下回合起产生 ${c.territoryTax} E地税入公账。`:""}${w.resources[a.p]?`后续矿产自动进入本族公账；首次占领未发奖中立矿奖励 ${c.discoveryReward} E，夺取敌方矿奖励 ${c.enemyMineReward} E，奖励优先给本人，溢出入公账。`:''}`);
  if(c.miningMode!=='automatic'&&w.canPay(a,'HARVEST')&&w.owners[a.p]===a.tribe) for(const n of fractions(Math.min(w.limit(a,'HARVEST'),w.capacity(a)-a.energy+w.survival(a)+w.fee(a,'HARVEST')))) add('HARVEST',[`${E(n)} E`],{amount:n},`${amountDesc(n,'HARVEST')} 从脚下四邻接本族网络请求，未知连接和竞争可能令产出为0，仍支付采集费。`);
  if(w.canPay(a,'ATTACK')) {
    const combatView=c.attackRange===1?o.local_view:(o.territory_live_view||o.local_view);
    for(const b of combatView.observed_agents){const p=w.index(...b.position);if(b.id!==a.id&&w.distance(a.p,p)<=c.attackRange&&(!tactics||(b.tribe_id!==a.tribe&&(tactics.stance!=='NEUTRAL'||tactics.nearMine(p)&&!tactics.enemyMine(p)))))add('ATTACK',['AGENT',b.id],{target:b.id},`攻击${c.attackRange}格内可见${b.tribe_id===a.tribe?'同族':'敌方'}个体 ${b.id}（${b.tribe_id}族），距离按横纵距离之和；费用 ${fee('ATTACK')} E；伤害基础 ${c.attackDamage*(1+0.1*w.level(a,'C1'))} E，对方减伤未知。${c.killLootEnabled?'击杀敌方可转移其致命伤害前全部剩余能量，溢出入公账；多人合击按伤害最高者归属，同伤害按固定种子裁定。':''}`);}
    const buildingTiles=c.attackRange===1?[a.p,...w.neighbors(a.p)]:combatView.cells.filter(cell=>cell.building).map(cell=>w.index(...cell.position));
    for(const p of buildingTiles) if(w.buildings[p]&&w.distance(a.p,p)<=c.attackRange&&(!tactics||(w.buildings[p].tribe!==a.tribe&&(tactics.stance!=='NEUTRAL'||tactics.nearMine(p)&&!tactics.enemyMine(p)))))add('ATTACK',['BUILDING',`${w.xy(p)}`],{building:p},`攻击${c.attackRange}格内 (${w.xy(p)}) 的 ${w.buildings[p].tribe}族 ${w.buildings[p].type}；费 ${fee('ATTACK')} E。`);
  }
  if(w.canPay(a,'TRANSFER')) {
    const max=a.energy-w.survival(a)-w.fee(a,'TRANSFER')-1;
    for(const n of fractions(max)) add('TRANSFER',['CONTRIBUTE',`${E(n)} E`],{mode:'CONTRIBUTE',amount:n},`远程自主上交公共池。${amountDesc(n,'TRANSFER',true)}`);
    for(const b of o.local_view.observed_agents) if(b.id!==a.id&&w.distance(a.p,w.index(...b.position))<=1) for(const n of fractions(max)) add('TRANSFER',['GIVE',b.id,`${E(n)} E`],{mode:'GIVE',target:b.id,amount:n},`赠予 ${b.id}，实际受对方容量与竞争限制，未转出保留。${amountDesc(n,'TRANSFER',true)}`);
    for(const g of o.own_authorizations.filter(g=>g.kind==='MEMBER')) for(const n of fractions(Math.min(U(g.amount),w.capacity(a)-a.energy+w.survival(a)+w.fee(a,'TRANSFER')))) add('TRANSFER',['WITHDRAW',g.id,`${E(n)} E`],{mode:'WITHDRAW',grant:g.id,amount:n},`在任意位置按本人额度 ${g.id} 领取。${amountDesc(n,'TRANSFER')}`);
  }
  if(c.reproductionMode==='individual'){
    for(const amount of c.birthInvestments.map(U))if(w.canPay(a,'REPRODUCE',amount))add('REPRODUCE',[`${E(amount)} E`],{amount},`单体繁殖，无需对象；本人投入 ${E(amount)} E 给同族孩子，另付手续费 ${fee('REPRODUCE')} E；须有相邻空格和人口名额，失败不扣费。`);
  }else{
    for(const b of o.local_view.observed_agents) if(b.id!==a.id&&b.tribe_id===a.tribe&&w.distance(a.p,w.index(...b.position))<=1) for(const amount of c.birthInvestments.map(U)) if(w.canPay(a,'REPRODUCE',amount)) add('REPRODUCE',[b.id,`${E(amount)} E`],{target:b.id,amount},`与 ${b.id} 繁殖，须双方互选；本人投入 ${E(amount)} E 给孩子，另付手续费 ${fee('REPRODUCE')} E；失败不扣费。`);
  }
  const allowedCells=o.territory_live_view?.cells||o.local_view.cells;
  const known=new Map(allowedCells.map(cell=>[w.index(...cell.position),cell]));
  for(const source of [...a.memory,...a.inbox]) if(source.available_turn<=w.turn&&source.expires_turn>w.turn) {
    const position=source.value?.position;
    if(Array.isArray(position)&&w.inBounds(...position)) {const p=w.index(...position);if(!known.has(p))known.set(p,source.value);}
  }
  if(w.canPay(a,'COMMUNICATE')) {
    const plans=[];
    for(const band of bands) for(const n of [5,10,20]) plans.push({intent:'ENERGY_REQUEST',claims:{balance_band:band,request_energy:n},path:[band,`${n} E`]});
    for(const [p,cell] of known) {
      if(cell.resource) for(const band of bands) plans.push({intent:'RESOURCE_REPORT',claims:{position:w.xy(p),stock_band:band},path:[`${w.xy(p)}`,band]});
      for(const n of ['0','1','2-3','4+']) plans.push({intent:'THREAT_REPORT',claims:{position:w.xy(p),enemy_count:n},path:[`${w.xy(p)}`,n]});
      for(const task of ['BUILD','REPAIR','DEFEND']) {
        plans.push({intent:'WORK_REQUEST',claims:{position:w.xy(p),task},path:[`${w.xy(p)}`,task,'NO_PROJECT']});
        const projects=o.role==='ruler'?o.public_management.projects.filter(g=>g.p===p):o.own_authorizations.filter(g=>g.kind==='PROJECT'&&w.index(...g.position)===p);
        for(const g of projects)plans.push({intent:'WORK_REQUEST',claims:{position:w.xy(p),task,project_id:g.id},path:[`${w.xy(p)}`,task,g.id]});
      }
    }
    if(o.role==='ruler') for(const band of bands) for(const policy of ['SAVE','DISTRIBUTE','BUILD']) plans.push({intent:'PUBLIC_REPORT',claims:{balance_band:band,policy},path:[band,policy]});
    for(const plan of plans) for(const style of ['NEUTRAL','URGENT']) add('COMMUNICATE',[plan.intent,...plan.path,style],{intent:plan.intent,claims:plan.claims,style},`向同族广播 ${JSON.stringify(plan.claims)}，${style}；声明可不真实；费 ${fee('COMMUNICATE')} E，下回合送达。`);
  }
  for(const p of w.neighbors(a.p)) {
    if(w.owners[p]!==a.tribe) continue;
    const b=w.buildings[p]; if(b&&b.tribe!==a.tribe) continue;
    if(!b&&(w.resources[p]||occupied[p]))continue;
    for(const type of b?[b.type]:Object.keys(c.buildings)) {
      const mode=b?(b.complete?'REPAIR':'CONTINUE'):'NEW',cost=w.fee(a,'BUILD',mode),space=U(c.buildings[type])-(b?.energy||0);
      if(!w.canPay(a,'BUILD',0,mode)||space<=0)continue;
      const sources=[{id:'PERSONAL',available:a.energy-w.survival(a)-cost-1},...o.own_authorizations.filter(g=>g.kind==='PROJECT'&&g.building===type&&w.index(...g.position)===p).map(g=>({id:g.id,available:U(g.amount)}))];
      for(const fund of sources)for(const n of fractions(Math.min(w.limit(a,'BUILD'),space,fund.available)))add('BUILD',[mode,type,`${w.xy(p)}`,fund.id,`${E(n)} E`],{mode,buildingType:type,p,funding:fund.id,amount:n},`${mode} ${type} 于 (${w.xy(p)})；资金 ${fund.id}，投入 ${E(n)} E，私人施工费 ${E(cost)} E；完成需 ${c.buildings[type]} E。`);
    }
  }
  if(o.role==='ruler'&&w.canPay(a,'TREASURY')) {
    const pm=o.public_management;
    for(const member of pm.registered_members) for(const n of fractions(U(pm.unreserved))) add('TREASURY',['ALLOCATE_MEMBER',member,`${E(n)} E`],{mode:'ALLOCATE_MEMBER',member,amount:n},`给 ${member} 设领取额度 ${E(n)} E；从未预留公共余额预留；下回合可用；私人行政费 ${fee('TREASURY')} E；未知远处存活状态。`);
    for(const [p,cell] of known) if(cell.owner_tribe===a.tribe&&!cell.resource) {
      if(!cell.building&&allowedCells.some(c=>w.index(...c.position)===p)&&o.territory_live_view.observed_agents.some(b=>w.index(...b.position)===p)) continue;
      for(const type of cell.building?[cell.building.type]:Object.keys(c.buildings)) for(const n of fractions(U(pm.unreserved)))add('TREASURY',['ALLOCATE_PROJECT',type,`${w.xy(p)}`,`${E(n)} E`],{mode:'ALLOCATE_PROJECT',p,buildingType:type,amount:n},`于 (${w.xy(p)}) 预留 ${type} 工程预算 ${E(n)} E，向登记族人发施工授权；工人须相邻施工；下回合生效；费 ${fee('TREASURY')} E。`);
    }
    for(const g of [...pm.grants,...pm.projects].filter(g=>!g.revokeTurn)) add('TREASURY',['REVOKE',g.id],{mode:'REVOKE',grant:g.id},`撤销 ${g.id} 未使用余额，下回合生效；本回合旧权利仍有效；费 ${fee('TREASURY')} E。`);
  }
  return leaves;
}
export function skillCandidates(w,a) {
  const list=[{path:['KEEP'],action:{type:'KEEP'},description:'保留升级机会；不消耗机会。'}];
  if(!a.opportunities)return list;
  for(const [id,[branch,name,pre]] of Object.entries(availableSkills(w.config))) {
    const level=a.skills[id]||0;
    if(level>=w.config.skillMaxLevel||(!level&&Object.keys(a.skills).length>=w.config.skillSlots)||(pre&&!a.skills[pre]))continue;
    const effects={C1:'攻击伤害 +10%',C2:'攻击成本 -10%',C3:'个人减伤 +8%',S1:'基础生存成本 -5%',S2:'移动成本 -10%',S3:'容量 +10%，不补能量',B1:'施工上限 +10%',B2:'新建/续建费 -10%',B3:'维修费 -10%',P1:'采集上限 +10%',P2:'采集费 -10%',P3:'转移费 -10%'};
    list.push({path:[branch,id],action:{type:'UPGRADE',skill:id},description:`${name} ${id}：${level} → ${level+1} 级；每级按基础值 ${effects[id]}；消耗1机会，占${level?'已有':'新增1个'}技能名额。`});
  }
  return list;
}

export const rootDescriptions={
  WAIT:'等待，只支付基础生存消耗。',MOVE:'在配置的步数内沿上下左右可通行空格移动，可拐弯；争格按固定随机键。',ATTACK:'攻击配置距离内可见个体或建筑；同时结算伤害，敌方击杀收益按当前规则转移。',
  HARVEST:'采集脚下本族地块连接的资源。若没有资源连接或库存，产出为0但仍扣费。',CLAIM:'占领脚下单格，下回合生效；行走不自动占领。',
  TRANSFER:'自主上交公共池、向相邻个体赠予、或按已收到额度远程领取。',COMMUNICATE:'选择声明与风格，付费同族广播，下回合送达；声明可以不真实。',
  BUILD:'相邻本族格新建、续建、维修，投入转为结构能量，另扣私人施工费。',REPRODUCE:'按当前繁殖规则，将私人投入转为同族子代能量，另付手续费。',
  TREASURY:'管理公共账：预留个人额度、工程预算或撤销，下回合生效；私人支付行政费。'
};
