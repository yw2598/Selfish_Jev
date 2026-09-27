import { tribes, units as U, energy as E, clone, key, fairShare } from './util.mjs';
import { candidates, skillCandidates } from './actions.mjs';

export function settle(w,decisions) {
  if(!w.prepared) throw new Error('必须先冻结回合');
  const beforeAlive=w.alive().map(a=>a.id),beforeDeaths=Object.fromEntries(tribes.map(t=>[t,w.metrics[t].deaths])),beforeBirths=Object.fromEntries(tribes.map(t=>[t,w.metrics[t].births]));
  const claimBudgets=Object.fromEntries(tribes.map(t=>[t,w.snapshotAccounts[t]-[...Object.values(w.snapshotGrants),...Object.values(w.snapshotProjects)].filter(g=>g.tribe===t).reduce((n,g)=>n+g.remaining,0)]));
  const intents=[];
  for(const id of beforeAlive) {
    const a=w.agents[id],decision=decisions[id]||{action:{type:'WAIT'},fault:'missing decision'};
    const action=decision.action;
    const o=w.lastObservations[id]||w.observation(a);
    const legal=candidates(w,a,o).some(leaf=>JSON.stringify(leaf.action)===JSON.stringify(action));
    if(!legal) {decision.fault='candidate validation failed';decision.action={type:'WAIT'};}
    a.lastAction=decision.action.type;w.lastDecisions[id]=clone(decision);
    if(decision.fault)w.events.push({turn:w.turn,actor:id,type:'SERVICE_FAULT',error:decision.fault});
    w.pay(a,Math.min(a.energy,w.survival(a)));w.die(a,'SURVIVAL');
    if(a.alive)intents.push({a,s:w.snapshotAgents[id],act:decision.action,decision});
  }
  const of=type=>intents.filter(i=>i.a.alive&&i.act.type===type);
  const success=(i,details={})=>w.receipt(i.a.id,i.act.type,'OK',details);
  const failure=(i,result='FAILED')=>w.receipt(i.a.id,i.act.type,result);
  const charges=(i,amount=0)=>i.a.energy-w.fee(i.a,i.act.type,i.act.mode)-amount>=1;
  const charge=i=>w.pay(i.a,w.fee(i.a,i.act.type,i.act.mode));
  for(const i of of('TREASURY')) {
    const {a,act}=i;let valid=false;
    if(act.mode==='REVOKE') {
      const g=w.grants[act.grant]||w.projects[act.grant];
      if(g?.tribe===a.tribe&&!g.revokeTurn){g.revokeTurn=w.turn+1;valid=true;}
    } else if(act.amount<=w.snapshotAccounts[a.tribe]-w.reserved(a.tribe)) {
      const id=`${a.tribe}:T${w.turn}:${act.mode}`;
      if(act.mode==='ALLOCATE_MEMBER'&&w.agents[act.member]?.alive&&w.agents[act.member].tribe===a.tribe) {w.grants[id]={id,tribe:a.tribe,member:act.member,remaining:act.amount,effectiveTurn:w.turn+1};valid=true;}
      if(act.mode==='ALLOCATE_PROJECT'&&w.owners[act.p]===a.tribe&&!w.resources[act.p]&&(!w.buildings[act.p]?!w.occupied[act.p]:w.buildings[act.p].tribe===a.tribe&&w.buildings[act.p].type===act.buildingType)) {w.projects[id]={id,tribe:a.tribe,p:act.p,type:act.buildingType,workers:[...w.registered[a.tribe]],remaining:act.amount,effectiveTurn:w.turn+1};valid=true;}
    }
    if(valid){charge(i);success(i);w.logTransfer(a.tribe,a.id,act.mode,act.amount||0,act.member||act.grant);}else failure(i,'NOT_EXECUTED');
  }
  const incoming=new Map(),withdrawals=new Map();
  const queue=(target,entry)=>{if(!incoming.has(target))incoming.set(target,[]);incoming.get(target).push(entry);};
  const harvestGroups=new Map();
  for(const i of of('HARVEST')) {
    charge(i);const component=w.net.byTile[i.s.p];
    if(!harvestGroups.has(component))harvestGroups.set(component,[]);
    harvestGroups.get(component).push(i);
  }
  for(const [id,group] of harvestGroups) {
    const component=w.net.components[id], available=component?.stock||0;
    const shares=fairShare(group.map(i=>({id:i.a.id,amount:Math.min(i.act.amount,w.capacity(i.a)-i.a.energy)})),available,[w.config.seed,w.turn,'harvest',id]);
    for(const i of group)queue(i.a.id,{id:`harvest:${i.a.id}`,kind:'HARVEST',i,amount:shares[i.a.id],component});
  }
  for(const i of of('TRANSFER')) {
    const {a,act}=i;
    if(act.mode==='CONTRIBUTE') {charge(i);a.energy-=act.amount;w.accounts[a.tribe]+=act.amount;w.metrics[a.tribe].contributed+=E(act.amount);w.logTransfer(a.tribe,a.id,'CONTRIBUTE',act.amount);success(i,{amount:E(act.amount)});}
    if(act.mode==='GIVE') {
      const target=w.agents[act.target];if(target?.alive&&w.distance(a.p,target.p)<=1)queue(target.id,{id:`give:${a.id}`,kind:'GIVE',i,amount:act.amount});else failure(i,'NOT_EXECUTED');
    }
    if(act.mode==='WITHDRAW') {
      const g=w.snapshotGrants[act.grant];if(g&&g.member===a.id&&w.active(g)){charge(i);queue(a.id,{id:`withdraw:${a.id}`,kind:'WITHDRAW',i,amount:Math.min(g.remaining,act.amount)});}else failure(i,'NOT_AUTHORIZED');
    }
  }
  // Incoming grants, gifts and harvest share one capacity budget. Outgoing gift costs are
  // reserved conservatively so allocation never depends on sender iteration order.
  const baseBalances=Object.fromEntries(w.alive().map(a=>[a.id,a.energy]));
  for(const [target,entries] of incoming) {
    const a=w.agents[target];if(!a.alive)continue;
    const shares=fairShare(entries.map(e=>({id:e.id,amount:e.amount})),Math.max(0,w.capacity(a)-baseBalances[target]),[w.config.seed,w.turn,'incoming',target]);
    for(const entry of entries) {
      const n=shares[entry.id],{i}=entry;
      if(entry.kind==='HARVEST') {
        let rest=n;for(const p of entry.component?.resources||[]){const r=w.resources[p],take=Math.min(rest,r.stock);r.stock-=take;rest-=take;if(!rest)break;}
        if(rest)throw new Error('网络库存不足');w.metrics[a.tribe].harvested+=E(n);w.receipt(a.id,'HARVEST',n?'OK':'NO_YIELD',{amount:E(n)});
      } else if(entry.kind==='GIVE') {
        if(n){charge(i);i.a.energy-=n;success(i,{amount:E(n),target});}else failure(i,'NO_TRANSFER');
      } else {
        const g=w.grants[i.act.grant];g.remaining-=n;w.accounts[a.tribe]-=n;w.metrics[a.tribe].withdrawn+=E(n);w.logTransfer(a.tribe,a.id,'WITHDRAW',n);success(i,{amount:E(n)});
      }
      a.energy+=n;
    }
  }
  const buildingGroups=new Map();
  for(const i of of('BUILD')) {if(!buildingGroups.has(i.act.p))buildingGroups.set(i.act.p,[]);buildingGroups.get(i.act.p).push(i);}
  for(const [p,group] of buildingGroups) {
    const schemes=[...new Set(group.map(i=>`${i.a.tribe}:${i.act.buildingType}`))].sort((a,b)=>key(w.config.seed,w.turn,p,a)-key(w.config.seed,w.turn,p,b)||a.localeCompare(b));
    const chosen=group.filter(i=>`${i.a.tribe}:${i.act.buildingType}`===schemes[0]);
    for(const i of group.filter(i=>!chosen.includes(i)))failure(i,'BUILD_CONFLICT');
    const valid=[];
    for(const i of chosen) {
      if(i.act.funding==='PERSONAL')valid.push({i,amount:i.act.amount});
      else {const g=w.snapshotProjects[i.act.funding];if(g&&w.active(g)&&g.workers.includes(i.a.id)&&g.p===p&&g.type===i.act.buildingType)valid.push({i,amount:Math.min(i.act.amount,g.remaining)});else failure(i,'NOT_AUTHORIZED');}
    }
    for(const fund of new Set(valid.map(v=>v.i.act.funding).filter(f=>f!=='PERSONAL'))) {
      const funded=valid.filter(v=>v.i.act.funding===fund),shares=fairShare(funded.map(v=>({id:v.i.a.id,amount:v.amount})),w.projects[fund].remaining,[w.config.seed,w.turn,fund]);funded.forEach(v=>v.amount=shares[v.i.a.id]);
    }
    const type=chosen[0].act.buildingType,space=U(w.config.buildings[type])-(w.buildings[p]?.energy||0);
    const shares=fairShare(valid.map(v=>({id:v.i.a.id,amount:v.amount})),space,[w.config.seed,w.turn,'building',p]);
    for(const {i} of valid) {
      const n=shares[i.a.id];if(!n){failure(i,'NO_BUILD');continue;}
      charge(i);
      if(i.act.funding==='PERSONAL')i.a.energy-=n;else {w.projects[i.act.funding].remaining-=n;w.accounts[i.a.tribe]-=n;w.logTransfer(i.a.tribe,i.a.id,'PROJECT_BUILD',n,i.act.funding);}
      if(!w.buildings[p])w.buildings[p]={type,tribe:i.a.tribe,energy:0,complete:false};
      const b=w.buildings[p];b.energy+=n;if(b.energy===U(w.config.buildings[type]))b.complete=true;
      w.metrics[i.a.tribe].buildInvested+=E(n);success(i,{amount:E(n),position:w.xy(p)});
    }
  }
  for(const i of of('COMMUNICATE')) {
    charge(i);const {a,act}=i;const body=i.decision.message?.body||`${act.intent}: ${JSON.stringify(act.claims)}`;
    w.messages.push({message_id:`M${w.turn}:${a.id}`,sender_id:a.id,tribe:a.tribe,sent_turn:w.turn,deliver_turn:w.turn+1,intent:act.intent,claims:clone(act.claims),body,style:act.style,unverified:true});
    w.metrics[a.tribe].communicationCost+=E(w.fee(a,'COMMUNICATE'));success(i,{message_id:`M${w.turn}:${a.id}`});
  }
  const damageAgents={},damageBuildings={},attackSources={};
  const attackable=new Set(w.alive().map(a=>a.id));
  for(const i of of('ATTACK')) {
    const {a,act}=i,target=act.target?w.agents[act.target]:null;
    if(act.target?!attackable.has(act.target):!w.buildings[act.building]){failure(i,'TARGET_UNAVAILABLE');continue;}
    charge(i);let damage=U(w.config.attackDamage)*(1+0.1*w.level(a,'C1'));
    if(target) {
      const fort=Object.entries(w.snapshotBuildings).some(([p,b])=>b.complete&&b.type==='FORT'&&b.tribe===target.tribe&&w.distance(Number(p),target.p)<=1);
      const defense=Math.min(w.config.maxDefense,1-(1-0.08*w.level(target,'C3'))*(1-(fort?w.config.fortDefense:0)));
      damage=Math.round(damage*(1-defense));damageAgents[target.id]=(damageAgents[target.id]||0)+damage;
      (attackSources[target.id]??=[]).push({a,damage});
    }else damageBuildings[act.building]=(damageBuildings[act.building]||0)+Math.round(damage);
    success(i,{target:act.target??w.xy(act.building),damage:E(Math.round(damage)),from:w.xy(i.s.p),to:w.xy(target?.p??act.building)});
  }
  const loot=[];
  for(const [id,n] of Object.entries(damageAgents)){
    const a=w.agents[id];
    const killers=w.config.killLootEnabled&&n>=a.energy?attackSources[id].filter(hit=>hit.damage>0&&hit.a.tribe!==a.tribe):[];
    killers.sort((x,y)=>y.damage-x.damage||key(w.config.seed,w.turn,'kill',id,x.a.id)-key(w.config.seed,w.turn,'kill',id,y.a.id)||x.a.id.localeCompare(y.a.id));
    if(killers.length){loot.push({victim:id,killer:killers[0].a,amount:a.energy});a.energy=0;}
    else w.pay(a,Math.min(a.energy,n));
    w.die(a,'ATTACK');
  }
  // Resolve every death before transferring spoils, so loot cannot prevent a
  // simultaneous death or be looted a second time through iteration order.
  for(const {victim,killer,amount} of loot.sort((a,b)=>a.victim.localeCompare(b.victim))){
    const personal=killer.alive?Math.min(amount,w.capacity(killer)-killer.energy):0,publicPart=amount-personal;
    killer.energy+=personal;w.accounts[killer.tribe]+=publicPart;
    w.metrics[killer.tribe].killLoot=(w.metrics[killer.tribe].killLoot||0)+E(amount);
    if(publicPart)w.logTransfer(killer.tribe,killer.id,'KILL_LOOT_PUBLIC',publicPart,victim);
    w.receipt(killer.id,'KILL_LOOT','OK',{victim,amount:E(amount),personal:E(personal),public:E(publicPart)});
  }
  for(const [p,n] of Object.entries(damageBuildings)){const b=w.buildings[p],actual=Math.min(b.energy,n);b.energy-=actual;w.dissipated+=actual;if(!b.energy)delete w.buildings[p];}
  const movement=new Map();
  for(const i of of('MOVE')){if(!movement.has(i.act.p))movement.set(i.act.p,[]);movement.get(i.act.p).push(i);}
  for(const [p,group] of movement) {
    const order=group.sort((a,b)=>key(w.config.seed,w.turn,'move',a.a.id)-key(w.config.seed,w.turn,'move',b.a.id)||a.a.id.localeCompare(b.a.id));
    const winner=order[0];
    const paths=new Map();
    if(w.moveTargets({...winner.a,p:winner.s.p},null,paths).has(p)&&charges(winner)){charge(winner);winner.a.p=p;success(winner,{position:w.xy(p),from:w.xy(winner.s.p),path:paths.get(p).map(q=>w.xy(q))});}else failure(winner,'MOVE_BLOCKED');
    for(const i of order.slice(1))failure(i,'MOVE_CONFLICT');
  }
  const claims=of('CLAIM');
  if(w.config.claimFunding==='public')claims.sort((a,b)=>key(w.config.seed,w.turn,'claim',a.a.id)-key(w.config.seed,w.turn,'claim',b.a.id)||a.a.id.localeCompare(b.a.id));
  for(const i of claims) {
    if(i.a.p===i.s.p&&(!w.buildings[i.a.p]||w.buildings[i.a.p].tribe===i.a.tribe)&&charges(i)){
      if(w.config.claimFunding==='public'){
        const cost=U(w.config.costs.CLAIM),tribe=i.a.tribe;
        if(Math.min(claimBudgets[tribe],w.accounts[tribe]-w.reserved(tribe))<cost){failure(i,'PUBLIC_FUNDS_INSUFFICIENT');continue;}
        w.accounts[tribe]-=cost;claimBudgets[tribe]-=cost;w.dissipated+=cost;w.logTransfer(tribe,i.a.id,'CLAIM_COST',cost);
      }else charge(i);
      const previousOwner=w.owners[i.a.p];w.owners[i.a.p]=i.a.tribe;
      if(w.config.claimReward>0&&previousOwner!==i.a.tribe){
        const bonus=U(w.config.claimReward),personal=Math.min(bonus,w.capacity(i.a)-i.a.energy),overflow=bonus-personal;
        i.a.energy+=personal;w.accounts[i.a.tribe]+=overflow;w.injected+=bonus;w.metrics[i.a.tribe].claimBonus=(w.metrics[i.a.tribe].claimBonus||0)+E(bonus);
        w.events.push({turn:w.turn,type:'CLAIM_REWARD',actor:i.a.id,position:w.xy(i.a.p),amount:E(bonus),personal:E(personal),public:E(overflow)});
        if(overflow)w.logTransfer(i.a.tribe,i.a.id,'CLAIM_REWARD_OVERFLOW',overflow);
      }
      const resource=w.resources[i.a.p];
      const enemyCapture=resource&&previousOwner&&previousOwner!==i.a.tribe&&w.config.enemyMineReward>0;
      if(w.config.miningMode==='automatic'&&resource&&(!resource.discovered||enemyCapture)){
        resource.discovered=true;
        const bonus=U(enemyCapture?w.config.enemyMineReward:w.config.discoveryReward),personal=Math.min(bonus,w.capacity(i.a)-i.a.energy),publicPart=bonus-personal;
        const metric=enemyCapture?'captureBonus':'discoveryBonus',event=enemyCapture?'CAPTURE_REWARD':'DISCOVERY_REWARD';
        i.a.energy+=personal;w.accounts[i.a.tribe]+=publicPart;w.injected+=bonus;w.metrics[i.a.tribe][metric]=(w.metrics[i.a.tribe][metric]||0)+E(bonus);
        if(publicPart)w.logTransfer(i.a.tribe,i.a.id,enemyCapture?'CAPTURE_OVERFLOW':'DISCOVERY_OVERFLOW',publicPart);
        w.events.push({turn:w.turn,type:event,actor:i.a.id,position:w.xy(i.a.p),amount:E(bonus),personal:E(personal),public:E(publicPart)});
        success(i,{position:w.xy(i.a.p),[enemyCapture?'capture_reward':'discovery_reward']:E(bonus),personal_reward:E(personal),public_overflow:E(publicPart)});
      }else success(i,{position:w.xy(i.a.p)});
    }else failure(i,'CLAIM_FAILED');
  }
  const repro=new Map(of('REPRODUCE').map(i=>[i.a.id,i])),groups=[];
  for(const i of repro.values()) {
    if(w.config.reproductionMode==='individual'){
      if(charges(i,i.act.amount))groups.push([i]);
    }else{
      const other=repro.get(i.act.target);
      if(other?.act.target===i.a.id&&i.a.id<other.a.id&&w.distance(i.a.p,other.a.p)<=1&&charges(i,i.act.amount)&&charges(other,other.act.amount))groups.push([i,other]);
    }
  }
  groups.sort((a,b)=>key(w.config.seed,w.turn,'birth',a[0].a.id)-key(w.config.seed,w.turn,'birth',b[0].a.id)||a[0].a.id.localeCompare(b[0].a.id));
  // Limits are enforced at settlement, not in the private candidate tree: hiding
  // REPRODUCE at the cap would reveal otherwise hidden live population counts.
  const livingAtBirth=w.alive(),currentOccupied=new Set(livingAtBirth.map(a=>a.p)),bred=new Set();
  let liveCount=livingAtBirth.length;
  const tribeCounts=Object.fromEntries(tribes.map(t=>[t,livingAtBirth.filter(a=>a.tribe===t).length]));
  for(const group of groups) {
    const i=group[0];
    if(liveCount>=w.config.maxPopulation||tribeCounts[i.a.tribe]>=w.config.maxPopulationPerTribe){
      w.events.push({turn:w.turn,type:'BIRTH_BLOCKED',actors:group.map(v=>v.a.id),reason:'POPULATION_LIMIT'});continue;
    }
    const options=[...new Set(group.flatMap(v=>w.neighbors(v.a.p)))].filter(p=>!w.occupied[p]&&!currentOccupied.has(p)&&w.passable(p,i.a.tribe,w.snapshotBuildings)&&w.passable(p,i.a.tribe)).sort((a,b)=>key(w.config.seed,w.turn,i.a.id,a)-key(w.config.seed,w.turn,i.a.id,b)||a-b);
    if(!options.length)continue;
    const p=options[0];for(const v of group){charge(v);v.a.energy-=v.act.amount;bred.add(v.a.id);}
    const child=w.newAgent(i.a.tribe,p,group.reduce((n,v)=>n+v.act.amount,0),group.map(v=>v.a.id));w.registered[child.tribe].push(child.id);w.metrics[child.tribe].births++;currentOccupied.add(p);
    liveCount++;tribeCounts[child.tribe]++;
    for(const v of group)success(v,{child:child.id});w.events.push({turn:w.turn,type:'BIRTH',actor:child.id,parents:child.parents});
  }
  for(const i of repro.values())if(!bred.has(i.a.id))failure(i,w.config.reproductionMode==='individual'?'NO_BIRTH':'NO_MUTUAL_BIRTH');
  for(const id of beforeAlive) {
    const a=w.agents[id];if(a.alive){a.age++;w.metrics[a.tribe].personTurns++;if(a.age%w.config.upgradeEvery===0)a.opportunities++;}
    const type=w.lastDecisions[id].action.type;w.metrics[a.tribe].actions[type]=(w.metrics[a.tribe].actions[type]||0)+1;
  }
  for(const tribe of tribes) {
    const people=w.alive().filter(a=>a.tribe===tribe),old=w.rulers[tribe];
    if(!w.agents[old]?.alive) {
      people.sort((a,b)=>{const ka=w.kinship(a.id,old),kb=w.kinship(b.id,old);return (ka===kb?0:ka<kb?-1:1)||b.energy-a.energy||key(w.config.seed,w.turn,a.id)-key(w.config.seed,w.turn,b.id);});
      w.rulers[tribe]=people[0]?.id||null;
      if(people.length)w.events.push({turn:w.turn,type:'SUCCESSION',actor:people[0].id,previous:old});
      else if(w.metrics[tribe].extinctTurn===null)w.metrics[tribe].extinctTurn=w.turn;
    }
    const deaths=w.metrics[tribe].deaths-beforeDeaths[tribe],births=w.metrics[tribe].births-beforeBirths[tribe],alpha=w.config.selfWeights[tribe];
    const groupReward=people.length/w.config.population+w.config.reward.demographyWeight*(births-deaths)/w.config.population;
    for(const id of beforeAlive.filter(id=>w.agents[id].tribe===tribe)){const self=w.agents[id].alive?1+w.config.reward.energyWeight*(w.agents[id].energy-w.snapshotAgents[id].energy)/U(w.config.capacity):-w.config.reward.deathPenalty;w.metrics[tribe].reward+=alpha*self+(1-alpha)*groupReward;}
  }
  const end=w.total(),expected=w.roundStartTotal+w.injected-w.dissipated;
  w.lastConservation={turn:w.turn,start:E(w.roundStartTotal),injected:E(w.injected),dissipated:E(w.dissipated),end:E(end),error:E(end-expected)};
  if(end!==expected)throw new Error(`能量不守恒: ${end-expected} centi-E`);
  for(const tribe of tribes)if(w.reserved(tribe)>w.accounts[tribe])throw new Error('公共预算透支');
  for(const a of w.alive())if(a.energy<1||a.energy>w.capacity(a))throw new Error('个人能量越界');
  w.prepared=false;w.history.push(w.statistics());w.revision++;
  return w.lastConservation;
}

export function applyUpgrade(w,a,action) {
  if(!skillCandidates(w,a).some(c=>JSON.stringify(c.action)===JSON.stringify(action)))throw new Error('非法技能升级');
  if(action.type==='UPGRADE'){a.skills[action.skill]=(a.skills[action.skill]||0)+1;a.opportunities--;}
}
