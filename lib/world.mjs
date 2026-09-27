import { tribes, units as U, energy as E, clone, hash, key, rng, shuffled, fairShare, validateConfig } from './util.mjs';
import {generateTerrain,resourceTiles} from './terrain.mjs';

export const skillDefinitions = {
  C1: ['战斗','强攻',null], C2: ['战斗','格斗熟练','C1'], C3: ['战斗','防御','C1'],
  S1: ['生存','节能代谢',null], S2: ['生存','跋涉','S1'], S3: ['生存','能量储备','S1'],
  B1: ['建造','施工熟练',null], B2: ['建造','高效施工','B1'], B3: ['建造','高效维修','B1'],
  P1: ['生产','采集熟练',null], P2: ['生产','高效采集','P1'], P3: ['生产','高效转移','P1']
};
export function availableSkills(config){
  if(config.miningMode!=='automatic')return skillDefinitions;
  const {P1,P2,...skills}=skillDefinitions;return {...skills,P3:['生产','高效转移',null]};
}
export class World {
  constructor(config) {
    this.config = validateConfig(clone(config)); this.turn = 0; this.owners = Array(config.width * config.height).fill(null);
    this.biomes=generateTerrain(this.config);
    this.resources = {}; this.buildings = {}; this.agents = {}; this.accounts = {}; this.rulers = {};
    if(this.config.nationalPolicyEnabled)this.nationalPolicies=Object.fromEntries(tribes.map(t=>[t,{stance:'NEUTRAL',selected_by:null,effective_turn:0}]));
    this.grants = {}; this.projects = {}; this.registered = {}; this.ledger = []; this.messages = []; this.events = [];
    this.history = []; this.lastDecisions = {}; this.lastObservations = {}; this.interventions = []; this.metrics = {};
    this.revision = 0; this.nextId = 0; this.nextSource = 0; this.prepared = false; this.audit = []; this.lastConservation = null;
    this.initialize();
  }
  initialize() {
    const c = this.config, random = rng(c.seed), zones = [[1,1],[c.width-7,1],[c.width-7,c.height-7],[1,c.height-7]];
    tribes.forEach((tribe,i) => {
      const [x,y] = zones[(i+c.rotation)%4], cells=[];
      for(let dy=0;dy<6;dy++) for(let dx=0;dx<6;dx++) { const p=this.index(x+dx,y+dy); cells.push(p); this.owners[p]=tribe; }
      const people=shuffled(cells,[c.seed,'spawn',i]).slice(0,c.population).map(p=>this.newAgent(tribe,p,U(c.initialEnergy)));
      this.rulers[tribe]=people[Math.floor(random()*people.length)].id;
      this.registered[tribe]=people.map(a=>a.id); this.accounts[tribe]=U(c.publicEnergy);
      this.metrics[tribe]={births:0,deaths:0,personTurns:0,harvested:0,contributed:0,withdrawn:0,buildInvested:0,communicationCost:0,extinctTurn:null,reward:0,actions:{}};
      if(c.miningMode==='automatic')Object.assign(this.metrics[tribe],{automaticIncome:0,discoveryBonus:0});
      if(c.subsistencePayment>0)Object.assign(this.metrics[tribe],{subsistencePaid:0,lastSubsistencePaid:0,lastSubsistenceDemand:0});
      // Resources remain walkable. Mirror the inner central tile at each corner;
      // all initial members can harvest via their connected starting territory.
      if(c.startingMinePerTribe){const p=this.index(x+(x===1?3:2),y+(y===1?3:2));this.resources[p]={stock:U(c.resourceStock),capacity:U(c.resourceCapacity),production:U(c.resourceProduction)};}
    });
    for(const p of resourceTiles(c,this.biomes,this.owners))this.resources[p]={stock:U(c.resourceStock),capacity:U(c.resourceCapacity),production:U(c.resourceProduction)};
    if(c.miningMode==='automatic')for(const [p,r] of Object.entries(this.resources))r.discovered=this.owners[p]!==null;
    this.initialTotal=this.total(); this.history.push(this.statistics());
  }
  index(x,y) { return y*this.config.width+x; }
  xy(p) { return [p%this.config.width,Math.floor(p/this.config.width)]; }
  inBounds(x,y) { return x>=0&&y>=0&&x<this.config.width&&y<this.config.height; }
  neighbors(p) { const [x,y]=this.xy(p); return [[x,y-1],[x+1,y],[x,y+1],[x-1,y]].filter(([a,b])=>this.inBounds(a,b)).map(([a,b])=>this.index(a,b)); }
  moveTargets(a,observation=null,paths=null) {
    // Unknown tiles remain possible destinations. Only settlement consults hidden
    // occupancy/buildings, so candidate availability cannot reveal the third ring.
    const view=observation&&(observation.territory_live_view||observation.local_view);
    const occupied=view?Object.fromEntries(view.observed_agents.map(b=>[this.index(...b.position),b.id])):(this.occupied||Object.fromEntries(this.alive().map(b=>[b.p,b.id])));
    const buildings=view?Object.fromEntries(view.cells.filter(c=>c.building).map(c=>[this.index(...c.position),c.building])):(this.snapshotBuildings||this.buildings);
    const distances=new Map([[a.p,0]]),queue=[a.p];
    if(paths)paths.set(a.p,[a.p]);
    for(let i=0;i<queue.length;i++) {
      const p=queue[i],steps=distances.get(p);if(steps>=this.config.movementRange)continue;
      for(const q of this.neighbors(p))if(!distances.has(q)&&!occupied[q]&&this.passable(q,a.tribe,buildings)){distances.set(q,steps+1);if(paths)paths.set(q,[...paths.get(p),q]);queue.push(q);}
    }
    distances.delete(a.p);return distances;
  }
  distance(p,q) { const [x,y]=this.xy(p),[a,b]=this.xy(q); return Math.abs(x-a)+Math.abs(y-b); }
  square(p,r) { const [x,y]=this.xy(p),cells=[]; for(let b=Math.max(0,y-r);b<=Math.min(this.config.height-1,y+r);b++) for(let a=Math.max(0,x-r);a<=Math.min(this.config.width-1,x+r);a++) cells.push(this.index(a,b)); return cells; }
  alive() { return Object.values(this.agents).filter(a=>a.alive); }
  newAgent(tribe,p,energy,parents=[]) {
    const living=this.alive();
    if(living.length>=this.config.maxPopulation||living.filter(a=>a.tribe===tribe).length>=this.config.maxPopulationPerTribe)throw new Error('人口上限已满，不能创建个体');
    const id=`${tribe}${String(this.nextId++).padStart(3,'0')}`;
    return this.agents[id]={id,tribe,p,energy,alive:true,age:0,parents,skills:{},opportunities:0,memory:[],inbox:[],receipts:[],seen:{},lastAction:'WAIT'};
  }
  level(a,s) { return a.skills[s]||0; }
  capacity(a) { return Math.round(U(this.config.capacity)*(1+0.1*this.level(a,'S3'))); }
  survival(a) { return Math.round(U(this.config.survivalCost)*(1-0.05*this.level(a,'S1'))); }
  fee(a,type,mode) {
    if(type==='CLAIM'&&this.config.claimFunding==='public')return 0;
    const skill={MOVE:'S2',ATTACK:'C2',HARVEST:'P2',TRANSFER:'P3',BUILD:mode==='REPAIR'?'B3':'B2'}[type];
    return Math.round(U(this.config.costs[type]||0)*(1-0.1*this.level(a,skill)));
  }
  limit(a,type) { return Math.round(U(type==='HARVEST'?this.config.harvestLimit:this.config.buildLimit)*(1+0.1*this.level(a,type==='HARVEST'?'P1':'B1'))); }
  canPay(a,type,amount=0,mode) { return a.energy-this.survival(a)-this.fee(a,type,mode)-amount>=1; }
  passable(p,tribe,buildings=this.buildings) { const b=buildings[p]; return !b||!b.complete||b.type==='FORT'||(b.type==='GATE'&&b.tribe===tribe); }
  total() { return Object.values(this.resources).reduce((n,r)=>n+r.stock,0)+Object.values(this.agents).reduce((n,a)=>n+a.energy,0)+Object.values(this.accounts).reduce((a,b)=>a+b,0)+Object.values(this.buildings).reduce((n,b)=>n+b.energy,0); }
  networks() {
    const byTile={},components=[];
    for(let p=0;p<this.owners.length;p++) {
      const tribe=this.owners[p]; if(!tribe||byTile[p]!==undefined) continue;
      const id=components.length, queue=[p], component={id,tribe,tiles:[],resources:[],stock:0}; byTile[p]=id;
      for(let i=0;i<queue.length;i++) { const q=queue[i]; component.tiles.push(q); if(this.resources[q]) {component.resources.push(q); component.stock+=this.resources[q].stock;}
        for(const n of this.neighbors(q)) if(this.owners[n]===tribe&&byTile[n]===undefined) {byTile[n]=id;queue.push(n);} }
      component.resources.sort((a,b)=>a-b); components.push(component);
    }
    return {byTile,components};
  }
  reserved(tribe) { return [...Object.values(this.grants),...Object.values(this.projects)].filter(g=>g.tribe===tribe).reduce((n,g)=>n+g.remaining,0); }
  active(g) { return g.effectiveTurn<=this.turn&&(!g.revokeTurn||g.revokeTurn>this.turn); }
  source(a,channel,text,value,topic,provenance,meta={}) {
    const t=this.turn, ttl=channel==='communication'?this.config.communicationTTL:this.config.memoryTTL;
    a.sourceSequence=(a.sourceSequence||0)+1;
    return {id:`${a.id}:${channel}:${t}:${a.sourceSequence}`,owner_id:a.id,channel,event_turn:t,available_turn:t,expires_turn:t+ttl,provenance,topic_key:topic,value,text,...meta};
  }
  receipt(id,type,result,details={},availableTurn=this.turn+1) {
    const a=this.agents[id]; if(!a) return;
    const item={type,result,...details,observed_turn:this.turn,available_turn:availableTurn}; a.receipts.push(item);
    a.memory.push(this.source(a,'memory',JSON.stringify(item),item,`action:${type}`,'own_receipt',{available_turn:availableTurn,expires_turn:this.turn+this.config.memoryTTL}));
    this.events.push({turn:this.turn,actor:id,type,result,...details});
  }
  prepare() {
    if(this.prepared) return;
    this.turn++; this.events=[]; this.nextSource=0; this.roundStartTotal=this.total(); this.injected=0; this.dissipated=0;
    for(const [p,r] of Object.entries(this.resources)) {
      const owner=this.owners[p];
      if(this.config.miningMode==='automatic'&&owner){
        const amount=r.stock+r.production;this.injected+=r.production;r.stock=0;this.accounts[owner]+=amount;
        this.metrics[owner].automaticIncome+=E(amount);
        this.logTransfer(owner,`mine:${p}`,'MINE_INCOME',amount);
        this.events.push({turn:this.turn,type:'MINE_INCOME',tribe:owner,position:this.xy(Number(p)),amount:E(amount),production:E(r.production)});
      }else{const n=Math.min(r.capacity-r.stock,r.production);r.stock+=n;this.injected+=n;}
    }
    for(const table of [this.grants,this.projects]) for(const [id,g] of Object.entries(table)) if(g.revokeTurn&&g.revokeTurn<=this.turn) delete table[id];
    if(this.config.territoryTax>0){
      const counts=Object.fromEntries(tribes.map(t=>[t,0]));for(const owner of this.owners)if(owner)counts[owner]++;
      for(const tribe of tribes){const amount=counts[tribe]*U(this.config.territoryTax);this.accounts[tribe]+=amount;this.injected+=amount;this.metrics[tribe].territoryIncome=(this.metrics[tribe].territoryIncome||0)+E(amount);if(amount){this.logTransfer(tribe,'territory','TERRITORY_TAX',amount);this.events.push({turn:this.turn,type:'TERRITORY_TAX',tribe,tiles:counts[tribe],amount:E(amount)});}}
    }
    if(this.config.subsistencePayment>0)this.distributeSubsistence();
    for(const a of this.alive()) {
      a.inbox=a.inbox.filter(s=>s.expires_turn>this.turn); a.memory=a.memory.filter(s=>s.expires_turn>this.turn);
      a.receipts=a.receipts.filter(r=>r.observed_turn>this.turn-this.config.memoryTTL);
      for(const msg of this.messages.filter(m=>m.deliver_turn===this.turn&&m.tribe===a.tribe)) {
        for(const [field,value] of Object.entries(msg.claims)) a.inbox.push(this.source(a,'communication',msg.body,{[field]:value},`${msg.intent}:${JSON.stringify(msg.claims.position??'')}:${field}`,'group_report',
          {id:`${a.id}:${msg.message_id}:${field}`,sender_id:msg.sender_id,message_id:msg.message_id,event_turn:msg.sent_turn,sent_turn:msg.sent_turn,deliver_turn:msg.deliver_turn,unverified:true}));
      }
    }
    this.prepared=true; this.net=this.networks(); this.snapshotAgents=clone(this.agents); this.snapshotBuildings=clone(this.buildings); this.snapshotGrants=clone(this.grants); this.snapshotProjects=clone(this.projects); this.snapshotOwners=[...this.owners];
    this.snapshotAccounts=clone(this.accounts); this.occupied=Object.fromEntries(this.alive().map(a=>[a.p,a.id])); this.snapshotHash=hash({turn:this.turn,agents:this.agents,resources:this.resources,owners:this.owners,buildings:this.buildings,accounts:this.accounts,grants:this.grants,projects:this.projects});
  }
  distributeSubsistence(){
    for(const tribe of tribes){
      const people=this.alive().filter(a=>a.tribe===tribe),target=U(this.config.subsistencePayment);
      const requests=people.map(a=>({id:a.id,amount:Math.min(target,Math.max(0,this.capacity(a)-a.energy))}));
      const shares=fairShare(requests,this.accounts[tribe],[this.config.seed,this.turn,tribe,'subsistence']);
      let paid=0;
      for(const a of people){const amount=shares[a.id];a.energy+=amount;this.accounts[tribe]-=amount;paid+=amount;
        this.receipt(a.id,'SUBSISTENCE',amount===target?'OK':amount?'PARTIAL':'ZERO',{amount:E(amount),target:E(target)},this.turn);
        if(amount)this.logTransfer(tribe,a.id,'SUBSISTENCE',amount);
      }
      const m=this.metrics[tribe];m.subsistencePaid=(m.subsistencePaid||0)+E(paid);m.lastSubsistencePaid=E(paid);m.lastSubsistenceDemand=E(requests.reduce((sum,r)=>sum+r.amount,0));
      // Survival funding precedes discretionary reservations. Trim commitments
      // proportionally only when the remaining account cannot back them all.
      const reservations=[...Object.values(this.grants),...Object.values(this.projects)].filter(g=>g.tribe===tribe&&g.remaining>0).sort((a,b)=>a.id.localeCompare(b.id));
      const reserved=reservations.reduce((n,g)=>n+g.remaining,0),balance=this.accounts[tribe];
      if(reserved>balance){let left=balance;const reduced=reservations.map(g=>{const amount=Number(BigInt(g.remaining)*BigInt(balance)/BigInt(reserved));left-=amount;return {g,amount};});
        for(const item of shuffled(reduced,[this.config.seed,this.turn,tribe,'reservation']))if(left){item.amount++;left--;}
        for(const {g,amount}of reduced){const previous=g.remaining;g.remaining=amount;if(previous!==amount)this.events.push({turn:this.turn,type:'RESERVATION_REDUCED',tribe,grant:g.id,previous:E(previous),remaining:E(amount),reason:'SUBSISTENCE_PRIORITY'});}
      }
    }
  }
  visibleTiles(a) {
    const set=new Set(this.square(a.p,2));
    if(this.rulers[a.tribe]===a.id) this.owners.forEach((owner,p)=>{if(owner===a.tribe) for(const q of this.square(p,this.config.rulerPadding)) set.add(q);});
    return [...set].sort((a,b)=>a-b);
  }
  view(cells) {
    const allowed=new Set(cells);
    return {cells:cells.map(p=>({position:this.xy(p),terrain:'PLAIN',...(this.config.terrainMode==='decorative'?{biome:this.biomes?.[p]||'PLAIN'}:{}),owner_tribe:this.owners[p],...(this.resources[p]?{resource:{stock:E(this.resources[p].stock),production:E(this.resources[p].production),capacity:E(this.resources[p].capacity),...(this.config.miningMode==='automatic'?{discovery_reward_available:!this.resources[p].discovered}:{})}}:{}),...(this.buildings[p]?{building:{type:this.buildings[p].type,tribe:this.buildings[p].tribe,energy:E(this.buildings[p].energy),complete:this.buildings[p].complete}}:{})})),
      observed_agents:this.alive().filter(a=>allowed.has(a.p)).map(a=>({id:a.id,tribe_id:a.tribe,position:this.xy(a.p),role:this.rulers[a.tribe]===a.id?'ruler':'member'}))};
  }
  observation(a) {
    const isRuler=this.rulers[a.tribe]===a.id, c=this.config;
    const visible=this.view(this.visibleTiles(a)), local=this.view(this.square(a.p,2));
    for(const cell of visible.cells) {
      const p=this.index(...cell.position), val=hash(cell);
      if(a.seen[p]!==val) { a.memory.push(this.source(a,'memory',JSON.stringify(cell),cell,`tile:${p}`,'past_observation')); a.seen[p]=val; }
    }
    const ownGrants=Object.values(this.grants).filter(g=>g.member===a.id&&this.active(g));
    const ownProjects=Object.values(this.projects).filter(g=>g.workers.includes(a.id)&&this.active(g));
    const o={rules_version:c.rulesVersion,turn:this.turn,snapshot_id:`${this.snapshotHash}:t${this.turn}`,phase:'WORLD_ACTION',role:isRuler?'ruler':'member',map:{width:c.width,height:c.height},
      objective:{strategy_id:a.tribe,self_weight:c.selfWeights[a.tribe],group_weight:1-c.selfWeights[a.tribe],failure_condition:'TRIBE_EXTINCTION'},
      self:{id:a.id,tribe_id:a.tribe,position:this.xy(a.p),energy:E(a.energy),energy_capacity:E(this.capacity(a)),survival_cost_due:E(this.survival(a)),spendable_before_action_fee:E(Math.max(0,a.energy-this.survival(a)-1)),age_completed_turns:a.age,parents:a.parents,skills:clone(a.skills),skill_slots_used:Object.keys(a.skills).length,skill_slots_max:c.skillSlots,upgrade_opportunities:a.opportunities},
      local_view:{center:this.xy(a.p),radius_chebyshev:2,...local},
      own_receipts:a.receipts.filter(r=>r.available_turn<=this.turn).slice(-8),
      own_authorizations:[...ownGrants.map(g=>({id:g.id,kind:'MEMBER',amount:E(g.remaining),effective_turn:g.effectiveTurn})),...ownProjects.map(g=>({id:g.id,kind:'PROJECT',position:this.xy(g.p),building:g.type,amount:E(Math.min(g.remaining,this.limit(a,'BUILD'))),effective_turn:g.effectiveTurn}))],
      leadership_notice:{ruler_id:this.rulers[a.tribe]},memory_context:{recent_raw:a.memory.filter(s=>s.available_turn<=this.turn),summaries:[],omitted_source_count:0},communication_context:{recent_raw:clone(a.inbox),summaries:[],omitted_source_count:0}};
    if(isRuler) {
      o.territory_live_view={source:'engine_ruler_live_view',as_of_turn:this.turn,territory_padding:c.rulerPadding,...visible};
      o.public_management={balance:E(this.accounts[a.tribe]),unreserved:E(this.accounts[a.tribe]-this.reserved(a.tribe)),registered_members:[...this.registered[a.tribe]],
        grants:Object.values(this.grants).filter(g=>g.tribe===a.tribe).map(g=>({...g,remaining:E(g.remaining)})),projects:Object.values(this.projects).filter(g=>g.tribe===a.tribe).map(g=>({...g,remaining:E(g.remaining)})),
        ledger:this.ledger.filter(l=>l.tribe===a.tribe).slice(-40),territory_networks:(this.net||this.networks()).components.filter(n=>n.tribe===a.tribe).map(n=>({id:n.id,tiles:n.tiles.map(p=>this.xy(p)),resources:n.resources.map(p=>this.xy(p)),stock:E(n.stock)}))};
    }
    if(c.nationalPolicyEnabled)o.national_policy=clone(this.nationalPolicies[a.tribe]);
    return o;
  }
  pay(a,n) { if(!Number.isInteger(n)||n<0||a.energy<n) throw new Error('非法支出'); a.energy-=n; this.dissipated+=n; }
  logTransfer(tribe,actor,type,amount,target) { this.ledger.push({turn:this.turn,tribe,actor,type,amount:E(amount),...(target?{target}: {})}); }
  die(a,cause) { if(a.alive&&a.energy===0) {a.alive=false;this.metrics[a.tribe].deaths++;this.events.push({turn:this.turn,actor:a.id,type:'DEATH',cause});} }
  ancestors(id) {
    const map=new Map([[id,0]]),queue=[id];
    for(let i=0;i<queue.length;i++) for(const p of this.agents[queue[i]]?.parents||[]) if(!map.has(p)||map.get(p)>map.get(queue[i])+1) {map.set(p,map.get(queue[i])+1);queue.push(p);}
    return map;
  }
  kinship(a,b) { const aa=this.ancestors(a),bb=this.ancestors(b); return Math.min(Infinity,...[...aa.keys()].filter(k=>bb.has(k)).map(k=>aa.get(k)+bb.get(k))); }
  statistics() {
    const net=this.networks();
    return {turn:this.turn,totalEnergy:E(this.total()),tribes:tribes.map(tribe=>{const people=this.alive().filter(a=>a.tribe===tribe),components=net.components.filter(n=>n.tribe===tribe);
      return {tribe,...(this.config.nationalPolicyEnabled?{nationalPolicy:this.nationalPolicies[tribe].stance}:{}),population:people.length,energy:E(people.reduce((n,a)=>n+a.energy,0)),averageEnergy:people.length?E(people.reduce((n,a)=>n+a.energy,0))/people.length:0,publicEnergy:E(this.accounts[tribe]),territory:components.reduce((n,c)=>n+c.tiles.length,0),networks:components.length,controlledResources:components.reduce((n,c)=>n+c.resources.length,0),effectiveProduction:E(components.flatMap(c=>c.resources).reduce((n,p)=>n+this.resources[p].production,0)),...clone(this.metrics[tribe])};})};
  }
  exportState() {
    return {config:clone(this.config),...(this.config.nationalPolicyEnabled?{nationalPolicies:clone(this.nationalPolicies)}:{}),biomes:clone(this.biomes||Array(this.owners.length).fill('PLAIN')),biomeHash:hash(this.biomes||[]),turn:this.turn,prepared:this.prepared,revision:this.revision,owners:this.owners.flatMap((tribe,p)=>tribe?[[p,tribe]]:[]),resources:clone(this.resources),buildings:clone(this.buildings),agents:this.alive().map(a=>({id:a.id,tribe:a.tribe,p:a.p,energy:E(a.energy),capacity:E(this.capacity(a)),age:a.age,parents:a.parents,skills:a.skills,ruler:this.rulers[a.tribe]===a.id,lastAction:a.lastAction})),rulers:this.rulers,statistics:this.statistics(),history:this.history,lastConservation:this.lastConservation,events:this.events.slice(-200),movementEvents:this.events.filter(e=>e.type==='MOVE'&&e.result==='OK'),combatEvents:this.events.filter(e=>e.type==='ATTACK'&&e.result==='OK').map(e=>({...e,killed:typeof e.target==='string'&&this.events.some(d=>d.type==='DEATH'&&d.actor===e.target&&d.cause==='ATTACK')})),interventions:this.interventions};
  }
}
