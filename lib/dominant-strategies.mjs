import {clone,hash,key,energy as E} from './util.mjs';

export const strategyVersion='dominant-v1';
// Priorities are practical heuristics, not a claim of game-theoretic dominance.
// Inputs deliberately contain no World or Agent object: only authorized
// observations, public configuration and the engine's legal action leaves.
export const strategyProfiles={
  A:{name:'混沌战帮',alpha:1,reserve:12,refill:30,birthReserve:26,donateAbove:90,aid:0,skills:['S1','S2','S3']},
  B:{name:'阿美瑞卡',alpha:.67,reserve:10,refill:26,birthReserve:20,donateAbove:60,aid:1,skills:['S1','S2','P3']},
  C:{name:'神圣泰拉',alpha:.33,reserve:8,refill:22,birthReserve:14,donateAbove:45,aid:2,skills:['S1','P3','S2']},
  D:{name:'蜂巢意志',alpha:0,reserve:6,refill:18,birthReserve:10,donateAbove:30,aid:3,skills:['S1','P3','S2']}
};
const distance=(a,b)=>Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1]);
const posKey=p=>p.join(',');
const point=(p,c)=>[p%c.width,Math.floor(p/c.width)];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export function dominantDecision(config,o,leaves,phase='WORLD_ACTION'){
  const profile=strategyProfiles[o.self.tribe_id],self=o.self,tribe=self.tribe_id;
  const fallback=reason=>({fallbackReason:reason,strategyVersion,profile:profile?.name});
  const result=(leaf,ruleId,reason)=>({decision:{action:clone(leaf.action),path:clone(leaf.path),trace:[],source:'dominant-rule',ruleId,reason,strategyVersion,profile:profile.name,observationHash:hash(o),model:null}});
  const choose=(list,score=()=>0)=>[...list].sort((a,b)=>score(b)-score(a)||key(config.seed,o.turn,self.id,phase,a.action)-key(config.seed,o.turn,self.id,phase,b.action))[0];
  if(!profile||Math.abs(o.objective.self_weight-profile.alpha)>1e-8)return fallback('自定义目标权重需要Kev判断');
  if(config.miningMode!=='automatic'||config.reproductionMode!=='individual')return fallback('历史采集或配对规则需要Kev判断');
  if(!leaves.length)return fallback('没有可用策略候选');
  if(leaves.length===1)return result(leaves[0],'only-option','只有一个合法选项');
  if(phase==='SKILL_UPGRADE'){
    // Maintain an economic skill progression without spending a model call.
    const upgrades=leaves.filter(l=>l.action.type==='UPGRADE');
    const wanted=profile.skills.find(skill=>upgrades.some(l=>l.action.skill===skill));
    const leaf=upgrades.find(l=>l.action.skill===wanted)||leaves.find(l=>l.action.type==='KEEP');
    return leaf?result(leaf,wanted?`upgrade-${wanted}`:'keep-upgrade',wanted?'按本组经济与生存技能顺序升级':'保留机会，等待本组技能前置或空位'):fallback('技能前置冲突');
  }
  const local=o.local_view,view=o.territory_live_view||local;
  const localEnemies=local.observed_agents.filter(a=>a.tribe_id!==tribe);
  const nearbyFriends=local.observed_agents.filter(a=>a.tribe_id===tribe);
  const danger=localEnemies.filter(a=>distance(self.position,a.position)<=config.attackRange);
  const ownMines=view.cells.filter(c=>c.resource&&c.owner_tribe===tribe);
  const threatenedMines=ownMines.filter(m=>view.observed_agents.some(a=>a.tribe_id!==tribe&&distance(a.position,m.position)<=config.attackRange));
  if(phase==='NATIONAL_POLICY'){
    let stance='NEUTRAL',reason='没有近身威胁，探索无主矿并守卫本族矿点';
    if(danger.length>nearbyFriends.length||danger.length&&self.energy<profile.reserve+config.costs.ATTACK){stance='CONSERVATIVE';reason='可见敌人占优或本人余量不足，优先安全扩张';}
    else if(threatenedMines.length&&localEnemies.length&&self.energy<profile.reserve)return fallback('守矿与国王自身撤退冲突');
    else if(localEnemies.length&&self.energy>=profile.reserve+2*config.costs.ATTACK&&nearbyFriends.length>localEnemies.length){stance='AGGRESSIVE';reason='可见局部人数占优且有行动余量，允许对敌交战与夺矿';}
    else if(threatenedMines.length){reason='本族矿点受威胁，优先矿区防守';}
    const leaf=leaves.find(l=>l.action.stance===stance);return leaf?result(leaf,`policy-${stance.toLowerCase()}`,reason):fallback('国家倾向候选不匹配');
  }

  const all=type=>leaves.filter(l=>l.action.type===type),wait=all('WAIT')[0],moves=all('MOVE');
  const receipts=o.own_receipts||[],recent=receipts.filter(r=>r.observed_turn>=o.turn-2);
  const failures=recent.filter(r=>['MOVE_BLOCKED','MOVE_CONFLICT','PUBLIC_FUNDS_INSUFFICIENT','CLAIM_FAILED','NO_BIRTH','NOT_AUTHORIZED'].includes(r.result));
  if(failures.length>=2)return fallback('连续行动失败，需要重新判断路线、预算或繁殖条件');
  const messages=o.communication_context?.recent_raw||[];
  const requests=new Map();
  for(const msg of messages){
    const value=msg.value||{};if(msg.sender_id===self.id||!msg.sender_id?.startsWith(tribe)||!['EMPTY','LOW'].includes(value.balance_band))continue;
    const old=requests.get(msg.sender_id);if(!old||old.sent_turn<msg.sent_turn)requests.set(msg.sender_id,msg);
  }
  for(const msg of requests.values())if(messages.some(other=>other.sender_id===msg.sender_id&&other.sent_turn===msg.sent_turn&&['MID','HIGH'].includes(other.value?.balance_band)))return fallback('同一成员同轮补给申报互相矛盾');

  const costs={...config.costs},skills=self.skills;
  for(const [type,skill]of [['MOVE','S2'],['ATTACK','C2'],['TRANSFER','P3']])costs[type]=Math.round(costs[type]*(1-.1*(skills[skill]||0))*100)/100;
  if(config.claimFunding==='public')costs.CLAIM=0;
  const after=(leaf)=>self.energy-self.survival_cost_due-(costs[leaf.action.type]||0)-(['REPRODUCE'].includes(leaf.action.type)||leaf.action.type==='TRANSFER'&&['GIVE','CONTRIBUTE'].includes(leaf.action.mode)?E(leaf.action.amount):0);
  const withdraw=all('TRANSFER').filter(l=>l.action.mode==='WITHDRAW'&&l.action.amount>0);
  const refill=choose(withdraw,l=>Math.min(E(l.action.amount),profile.refill-self.energy)*100-E(l.action.amount));
  const floor=Math.max(2,profile.reserve*.35);
  const safeMoves=moves.filter(l=>after(l)>=floor);
  const retreat=choose(safeMoves,l=>Math.min(...localEnemies.map(e=>distance(point(l.action.p,config),e.position))));
  const nearestThreat=localEnemies.length?Math.min(...localEnemies.map(e=>distance(self.position,e.position))):Infinity;
  if(danger.length&&self.energy<profile.reserve&&refill)return fallback('当前需要补给，同时存在射程内敌人，补给与交战冲突');
  if(danger.length&&(self.energy<profile.reserve+costs.ATTACK||danger.length>nearbyFriends.length)&&retreat&&Math.min(...localEnemies.map(e=>distance(point(retreat.action.p,config),e.position)))>nearestThreat)return result(retreat,'retreat','可见威胁下增加敌我距离，保留行动余量；不能保证避开本轮先结算的攻击');

  const here=local.cells.find(c=>same(c.position,self.position));
  const friendlyCells=view.cells.filter(c=>c.owner_tribe===tribe);
  const neighborsOwned=p=>friendlyCells.filter(c=>distance(c.position,p)===1).length;
  const claim=all('CLAIM')[0],failedClaim=recent.some(r=>r.type==='CLAIM'&&r.result!=='OK');
  if(claim&&here?.resource&&!failedClaim&&!danger.length){
    const knownFunds=o.public_management?.unreserved;
    if(config.claimFunding!=='public'||knownFunds===undefined||knownFunds>=config.costs.CLAIM)return result(claim,here.owner_tribe?'capture-mine':'claim-mine',here.owner_tribe?'夺取脚下敌矿，获取个人奖励与后续族群收入':'占领脚下无主矿，获取个人奖励与后续族群收入');
  }
  if(refill&&self.energy<profile.refill)return result(refill,'withdraw','已有正式授权，主动领取补足本组行动储备');
  if(config.contiguousExpansion&&claim&&!here?.resource&&!here?.owner_tribe&&!danger.length&&!failedClaim&&neighborsOwned(self.position)>0&&after(claim)>=floor&&(o.public_management?.unreserved===undefined||o.public_management.unreserved>=config.costs.CLAIM+config.subsistencePayment*(nearbyFriends.length+1)))return result(claim,'claim-frontier','占领与己方四邻接的无主地块，填补边界；公账支付占地费，本人获得奖励，下一轮起产生地税');

  const pm=o.public_management,grants=pm?.grants||[];
  const pending=id=>grants.some(g=>g.member===id&&g.remaining>0&&!g.revokeTurn);
  if(pm){
    const publicReserve=config.costs.CLAIM*2+config.subsistencePayment*Math.max(1,nearbyFriends.length);
    const allocations=all('TREASURY').filter(l=>l.action.mode==='ALLOCATE_MEMBER'&&E(l.action.amount)<=Math.max(0,pm.unreserved-publicReserve)&&!pending(l.action.member));
    const allocateTo=id=>choose(allocations.filter(l=>l.action.member===id),l=>-Math.abs(E(l.action.amount)-profile.refill));
    if(self.energy<profile.reserve+4){const leaf=allocateTo(self.id);if(leaf)return result(leaf,'self-authorization','提前给自己建立补给授权，避免能量低到无法管理公账');}
    const visible=view.observed_agents.filter(a=>a.tribe_id===tribe&&a.id!==self.id);
    const needy=[...requests.keys()].filter(id=>pm.registered_members.includes(id)).map(id=>({id})).sort((a,b)=>requests.get(a.id).sent_turn-requests.get(b.id).sent_turn||a.id.localeCompare(b.id));
    for(const member of needy){const leaf=allocateTo(member.id);if(leaf)return result(leaf,'requested-authorization','在保留本人行动储备与公共占地预算后，处理已收到的同族补给请求；申报仍未核验');}
    if(profile.aid>=1||visible.length<=1){
      const funded=new Set((pm.ledger||[]).filter(e=>e.type==='ALLOCATE_MEMBER'&&e.turn>=o.turn-12).map(e=>e.target));
      for(const member of visible.filter(a=>!funded.has(a.id)).sort((a,b)=>a.id.localeCompare(b.id))){const leaf=allocateTo(member.id);if(leaf)return result(leaf,'proactive-authorization','为可见且近期未获额外拨款的族人预留行动资金');}
    }
  }

  const attack=all('ATTACK').filter(l=>l.action.target&&after(l)>=profile.reserve);
  if(attack.length){
    if(new Set(danger.map(e=>e.tribe_id)).size>1)return fallback('多个敌族同时进入交战范围，目标选择冲突');
    const selected=choose(attack,l=>-distance(self.position,view.observed_agents.find(e=>e.id===l.action.target).position));
    if(nearbyFriends.length>=danger.length&&(o.national_policy?.stance==='AGGRESSIVE'||threatenedMines.length))return result(selected,'attack','在合法国家倾向下，以有余量的局部兵力攻击可见目标；不假定知道敌方能量或能否击杀');
    if(danger.length)return fallback('交战收益与未知敌方状态无法由优先规则确定');
  }

  const lastRequest=receipts.some(r=>r.type==='COMMUNICATE'&&r.result==='OK'&&r.observed_turn>=o.turn-5);
  if(self.energy<=Math.max(4,profile.reserve/2)&&!refill&&!lastRequest&&!danger.length){
    const request=all('COMMUNICATE').find(l=>l.action.intent==='ENERGY_REQUEST'&&l.action.claims.balance_band==='LOW'&&l.action.claims.request_energy===20&&l.action.style==='NEUTRAL');
    if(request&&after(request)>=1)return result(request,'request-supply','在仍能通信时请求20 E额外补给，避免连续重复广播');
  }

  if(profile.aid>=2&&!danger.length){
    const gifts=all('TRANSFER').filter(l=>l.action.mode==='GIVE'&&requests.has(l.action.target)&&after(l)>=profile.reserve);
    const gift=choose(gifts,l=>Math.min(E(l.action.amount),10)*100-E(l.action.amount));
    if(gift)return result(gift,'aid-neighbor','响应相邻族人的低能量申报，同时保留本组最低储备');
  }

  const recentBirth=receipts.some(r=>r.type==='REPRODUCE'&&r.result==='OK'&&r.observed_turn>=o.turn-8);
  const production=ownMines.reduce((sum,c)=>sum+c.resource.production,0);
  const birth=choose(all('REPRODUCE').filter(l=>after(l)>=profile.birthReserve),l=>profile.aid>=2?E(l.action.amount):-E(l.action.amount));
  if(birth&&!danger.length&&!recentBirth&&ownMines.length&&production>=config.subsistencePayment*(nearbyFriends.length+1))return result(birth,'reproduce','已知矿产可支撑可见人口且保留本组繁殖后储备，产生同族子代；未知全族人口仍由结算检查');

  const known=new Map();
  for(const source of o.memory_context?.recent_raw||[]){const cell=source.value;if(cell?.position&&'owner_tribe'in cell)known.set(posKey(cell.position),cell);}
  for(const cell of view.cells)known.set(posKey(cell.position),cell);
  const mineTargets=[...known.values()].filter(c=>c.resource&&c.owner_tribe!==tribe&&(c.owner_tribe===null||o.national_policy?.stance==='AGGRESSIVE'));
  const visits=receipts.filter(r=>r.type==='MOVE'&&r.result==='OK'&&r.position).map(r=>r.position);
  const occupied=new Set(view.observed_agents.filter(a=>a.id!==self.id).map(a=>posKey(a.position)));
  const targets=mineTargets.filter(c=>!occupied.has(posKey(c.position))&&!same(c.position,self.position));
  if(config.contiguousExpansion&&!danger.length){
    const frontier=view.cells.filter(c=>!c.owner_tribe&&!c.building&&neighborsOwned(c.position)>0&&!occupied.has(posKey(c.position)));
    const connectedMoves=safeMoves.filter(l=>{const p=point(l.action.p,config);return (known.get(posKey(p))?.owner_tribe===tribe||frontier.some(c=>same(c.position,p)))&&frontier.some(t=>distance(p,t.position)<distance(self.position,t.position));});
    if(connectedMoves.length){
      const leaf=choose(connectedMoves,l=>{const p=point(l.action.p,config);return Math.max(...frontier.map(t=>neighborsOwned(t.position)*5+(t.resource?18:0)-distance(p,t.position)*4+(same(p,t.position)?12:0)))-visits.filter(v=>same(v,p)).length*5;});
      return result(leaf,'connect-frontier','沿已有领土推进到相邻无主地，优先填凹口和连接地块，避免跳跃式散点占领');
    }
  }
  const approach=safeMoves.filter(l=>targets.some(t=>distance(point(l.action.p,config),t.position)<distance(self.position,t.position)));
  if(approach.length){
    const leaf=choose(approach,l=>Math.max(...targets.map(t=>20-distance(point(l.action.p,config),t.position)*3+(same(point(l.action.p,config),t.position)?20:0)))-visits.filter(p=>same(p,point(l.action.p,config))).length*8);
    return result(leaf,'approach-mine','沿可行路线接近观察或私人记忆中的矿点，到达后另用占领行动');
  }

  if(self.energy>profile.donateAbove&&!danger.length){
    const contribution=choose(all('TRANSFER').filter(l=>l.action.mode==='CONTRIBUTE'&&after(l)>=profile.refill),l=>E(l.action.amount));
    if(contribution)return result(contribution,'contribute-surplus','只把超过本组储备目标的余量上交公账');
  }
  const fundedBuild=choose(all('BUILD').filter(l=>l.action.funding!=='PERSONAL'&&after(l)>=profile.reserve),l=>E(l.action.amount));
  if(fundedBuild&&profile.aid>=2&&!danger.length)return result(fundedBuild,'funded-build','安全且有正式工程预算时施工，避免用私人储备盲目建造');
  if(safeMoves.length&&!danger.length){
    const novelty=p=>{let score=0;for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const q=[p[0]+dx,p[1]+dy];if(q[0]>=0&&q[1]>=0&&q[0]<config.width&&q[1]<config.height&&!known.has(posKey(q)))score++;}return score;};
    const leaf=choose(safeMoves,l=>novelty(point(l.action.p,config))*2-visits.filter(p=>same(p,point(l.action.p,config))).length*12+distance(self.position,point(l.action.p,config))*.1);
    if(leaf)return result(leaf,'explore','探索较少观察过的区域，降低近期往返，保留最低行动余量');
  }
  if(danger.length&&self.energy>=profile.reserve)return fallback('存在威胁但没有明确的攻击或撤退方案');
  return wait?result(wait,'save-energy','没有满足余量约束的收益行动，等待生活费或已申请的授权'):fallback('没有适用的优先策略');
}
