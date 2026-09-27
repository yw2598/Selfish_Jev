import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {World} from '../lib/world.mjs';
import {candidates} from '../lib/actions.mjs';
import {settle} from '../lib/settle.mjs';
import {mergeConfig,clone,validateConfig} from '../lib/util.mjs';
import {rulesFor} from '../lib/policy.mjs';
import {CombatEffects} from '../public/combat-effects.js';

const defaults=JSON.parse(readFileSync(new URL('../defaults.json',import.meta.url),'utf8'));
function make(patch={}){return new World(mergeConfig(defaults,{territoryTax:0,claimReward:0,contiguousExpansion:false,population:1,resourceCount:0,startingMinePerTribe:false,subsistencePayment:0,nationalPolicyEnabled:false,...patch}));}
function stage(w){w.prepare();for(const a of w.alive())w.lastObservations[a.id]=w.observation(a);}
function choose(w,a,type,filter=()=>true){const option=candidates(w,a,w.lastObservations[a.id]).find(l=>l.action.type===type&&filter(l.action));assert.ok(option,`missing ${type} for ${a.id}`);return {action:clone(option.action)};}
function finish(w,actions={}){settle(w,Object.fromEntries(w.alive().map(a=>[a.id,actions[a.id]||{action:{type:'WAIT'}}])));assert.equal(w.lastConservation.error,0);}
function battle(patch={}){const w=make(patch),[a,b]=w.alive();a.p=w.index(15,15);b.p=w.index(17,16);return {w,a,b};}

test('current defaults start on a 24-square map at 10 private / 30 public E with 12 mines',()=>{
  const w=new World(defaults);assert.equal(w.alive().length,20);assert.ok(w.alive().every(a=>a.energy===1000));assert.ok(Object.values(w.accounts).every(e=>e===3000));
  assert.equal(w.config.width,24);assert.equal(w.config.height,24);assert.equal(Object.keys(w.resources).length,12);assert.equal(Object.keys(w.resources).filter(p=>w.owners[p]===null).length,8);
  assert.equal(w.config.discoveryReward,10);assert.equal(w.config.enemyMineReward,10);assert.equal(w.config.costs.CLAIM,5);assert.equal(w.config.movementRange,3);assert.equal(w.config.attackRange,3);
  for(const tribe of ['A','B','C','D'])assert.equal(Object.keys(w.resources).filter(p=>w.owners[p]===tribe).length,1);
  for(const width of [32,64]){const full=new World(mergeConfig(defaults,{width,height:width,resourceCount:null,resourceDensity:1})),half=new World(mergeConfig(defaults,{width,height:width,resourceCount:null}));assert.equal(Object.keys(half.resources).length,Math.round(Object.keys(full.resources).length/2));assert.deepEqual(new World(half.config).resources,half.resources);}
  assert.equal(Object.keys(new World(mergeConfig(defaults,{resourceCount:10})).resources).length,10);
});

test('old save files retain their original costs, ranges and absence of loot',()=>{
  const c=clone(defaults);for(const field of ['enemyMineReward','killLootEnabled','claimFunding','movementRange','attackRange','resourceDensity'])delete c[field];
  validateConfig(c);assert.equal(c.claimFunding,'personal');assert.equal(c.movementRange,1);assert.equal(c.attackRange,1);assert.equal(c.resourceDensity,1);assert.equal(c.enemyMineReward,0);assert.equal(c.killLootEnabled,false);
  for(const patch of [{movementRange:4},{attackRange:0},{resourceDensity:-.1},{enemyMineReward:-1},{claimFunding:'free'},{killLootEnabled:1}])assert.throws(()=>make(patch));
});

test('claim consumes 5 E from public funds and only survival from even a low-energy individual',()=>{
  const w=make(),a=w.alive()[0];a.p=w.index(16,16);a.energy=101;stage(w);finish(w,{[a.id]:choose(w,a,'CLAIM')});assert.equal(a.energy,1);assert.equal(w.accounts.A,2500);assert.equal(w.owners[a.p],'A');assert.equal(w.lastConservation.dissipated,9);
});

test('claim cannot spend reserved funds; private candidates reveal no hidden treasury balance',()=>{
  const w=make({population:2}),a=w.alive().find(a=>a.tribe==='A'&&a.id!==w.rulers.A);a.p=w.index(16,16);w.grants.g={id:'g',tribe:'A',member:a.id,remaining:2600,effectiveTurn:1};stage(w);
  const before=candidates(w,a,w.lastObservations[a.id]);w.accounts.A=0;assert.deepEqual(candidates(w,a,w.lastObservations[a.id]),before);w.accounts.A=3000;
  finish(w,{[a.id]:choose(w,a,'CLAIM')});assert.equal(w.owners[a.p],null);assert.equal(w.accounts.A,3000);assert.equal(a.energy,900);assert.equal(a.receipts.at(-1).result,'PUBLIC_FUNDS_INSUFFICIENT');
});

test('simultaneous claimants share the public budget deterministically without overdrawing',()=>{
  const results=[];for(const reverse of [false,true]){const w=make({population:3}),group=w.alive().filter(a=>a.tribe==='A');group.forEach((a,i)=>a.p=w.index(14+i,16));w.accounts.A=500;if(reverse)w.agents=Object.fromEntries(Object.entries(w.agents).reverse());stage(w);finish(w,Object.fromEntries(group.map(a=>[a.id,choose(w,a,'CLAIM')])));assert.equal(w.accounts.A,0);assert.equal(group.filter(a=>w.owners[a.p]==='A').length,1);assert.ok(group.every(a=>a.energy===900));results.push(group.find(a=>w.owners[a.p]==='A').id);}assert.equal(...results);
});

test('same-turn contributions cannot finance a claim submitted against an empty treasury',()=>{
  const w=make({population:2}),[a,donor]=w.alive().filter(a=>a.tribe==='A');a.p=w.index(16,16);w.accounts.A=0;stage(w);finish(w,{[a.id]:choose(w,a,'CLAIM'),[donor.id]:choose(w,donor,'TRANSFER',a=>a.mode==='CONTRIBUTE'&&a.amount>500)});assert.equal(w.owners[a.p],null);assert.ok(w.accounts.A>500);
});

test('first neutral claim awards 10 E and enemy capture awards a separate 10 E, income changes next round',()=>{
  const w=make(),[a,b]=w.alive(),p=w.index(16,16);a.p=p;w.resources[p]={stock:0,capacity:10000,production:1000,discovered:false};stage(w);finish(w,{[a.id]:choose(w,a,'CLAIM')});
  assert.equal(a.energy,1900);assert.equal(w.accounts.A,2500);assert.equal(w.metrics.A.discoveryBonus,10);assert.equal(w.resources[p].stock,1000);
  a.p=w.index(15,16);b.p=p;stage(w);assert.equal(w.accounts.A,4500);finish(w,{[b.id]:choose(w,b,'CLAIM')});assert.equal(b.energy,1800);assert.equal(w.accounts.B,2500);assert.equal(w.metrics.B.captureBonus,10);assert.equal(w.metrics.B.discoveryBonus,0);
  stage(w);assert.equal(w.accounts.B,3500);assert.equal(w.accounts.A,4500);assert.ok(!candidates(w,b,w.lastObservations[b.id]).some(l=>l.action.type==='CLAIM'));finish(w);
});

test('mine rewards overflow to treasury; an already discovered neutral mine grants no second discovery reward',()=>{
  const w=make(),a=w.alive()[0],p=w.index(16,16);a.p=p;a.energy=9950;w.resources[p]={stock:0,capacity:10000,production:0,discovered:false};stage(w);finish(w,{[a.id]:choose(w,a,'CLAIM')});assert.equal(a.energy,10000);assert.equal(w.accounts.A,3350);
  w.owners[p]=null;stage(w);finish(w,{[a.id]:choose(w,a,'CLAIM')});assert.equal(w.metrics.A.discoveryBonus,10);assert.equal(a.energy,9900);assert.equal(w.accounts.A,2850);
});

test('movement accepts a three-step bent path, rejects range four and charges once',()=>{
  const w=make(),a=w.alive()[0];a.p=w.index(15,15);stage(w);const leaves=candidates(w,a,w.lastObservations[a.id]);assert.ok(!leaves.some(l=>l.action.type==='MOVE'&&l.action.p===w.index(17,17)));
  finish(w,{[a.id]:choose(w,a,'MOVE',act=>act.p===w.index(17,16))});assert.equal(a.p,w.index(17,16));assert.equal(a.energy,800);
});

test('movement routes around walls within three steps but never jumps through a blockade',()=>{
  const w=make(),a=w.alive()[0];a.p=w.index(15,15);const wall=w.index(16,15);w.buildings[wall]={type:'WALL',tribe:'B',energy:3000,complete:true};stage(w);let leaves=candidates(w,a,w.lastObservations[a.id]);assert.ok(!leaves.some(l=>l.action.type==='MOVE'&&l.action.p===w.index(17,15)));assert.ok(leaves.some(l=>l.action.type==='MOVE'&&l.action.p===w.index(16,16)));
  finish(w,{[a.id]:choose(w,a,'MOVE',act=>act.p===w.index(16,16))});assert.equal(a.p,w.index(16,16));
});

test('unknown destination occupancy does not leak through candidates, but blocks actual movement',()=>{
  const w=make({population:2}),a=w.alive().find(a=>a.tribe==='A'&&a.id!==w.rulers.A),b=w.alive().find(a=>a.tribe==='B');a.p=w.index(15,15);b.p=w.index(18,15);stage(w);const o=w.lastObservations[a.id];assert.ok(!o.local_view.observed_agents.some(a=>a.id===b.id));
  const move=choose(w,a,'MOVE',act=>act.p===b.p);finish(w,{[a.id]:move});assert.equal(a.p,w.index(15,15));assert.equal(a.energy,900);assert.equal(a.receipts.at(-1).result,'MOVE_BLOCKED');
});

test('attacks reach visible targets at Manhattan distance three, exclude four and do not expand visibility',()=>{
  const {w,a,b}=battle();b.energy=3000;stage(w);finish(w,{[a.id]:choose(w,a,'ATTACK',act=>act.target===b.id)});assert.equal(b.energy,1900);assert.equal(a.energy,500);assert.ok(!w.events.some(e=>e.type==='KILL_LOOT'));
  const w2=make({population:2}),member=w2.alive().find(a=>a.tribe==='A'&&a.id!==w2.rulers.A),enemy=w2.alive().find(a=>a.tribe==='B');member.p=w2.index(15,15);enemy.p=w2.index(18,15);stage(w2);assert.ok(!candidates(w2,member,w2.lastObservations[member.id]).some(l=>l.action.type==='ATTACK'&&l.action.target===enemy.id));
  enemy.p=w2.index(17,17);w2.lastObservations[member.id]=w2.observation(member);assert.ok(!candidates(w2,member,w2.lastObservations[member.id]).some(l=>l.action.type==='ATTACK'&&l.action.target===enemy.id));
});

test('visible buildings can be attacked at range three',()=>{
  const w=make(),a=w.alive()[0];a.p=w.index(15,15);const p=w.index(17,16);w.buildings[p]={type:'WALL',tribe:'B',energy:3000,complete:true};stage(w);finish(w,{[a.id]:choose(w,a,'ATTACK',act=>act.building===p)});assert.equal(w.buildings[p].energy,2000);
});

test('lethal damage transfers all pre-hit remaining personal energy, leaves enemy treasury untouched, and emits animation coordinates',()=>{
  const {w,a,b}=battle();stage(w);finish(w,{[a.id]:choose(w,a,'ATTACK',act=>act.target===b.id)});assert.equal(b.alive,false);assert.equal(b.energy,0);assert.equal(a.energy,1400);assert.equal(w.accounts.B,3000);assert.equal(w.lastConservation.injected,0);assert.equal(w.metrics.A.killLoot,9);
  const event=w.exportState().combatEvents[0];assert.deepEqual(event.from,[15,15]);assert.deepEqual(event.to,[17,16]);assert.equal(event.killed,true);assert.equal(event.damage,10);
});

test('loot overflow reaches the killer treasury without increasing total world energy',()=>{
  const {w,a,b}=battle();a.energy=10000;stage(w);finish(w,{[a.id]:choose(w,a,'ATTACK',act=>act.target===b.id)});assert.equal(a.energy,10000);assert.equal(w.accounts.A,3400);assert.equal(w.lastConservation.injected,0);
});

test('mutual kills stay simultaneous; each reward reaches its deceased killer treasury',()=>{
  const {w,a,b}=battle();stage(w);finish(w,{[a.id]:choose(w,a,'ATTACK',act=>act.target===b.id),[b.id]:choose(w,b,'ATTACK',act=>act.target===a.id)});assert.equal(a.alive,false);assert.equal(b.alive,false);assert.equal(a.energy,0);assert.equal(b.energy,0);assert.equal(w.accounts.A,3500);assert.equal(w.accounts.B,3500);assert.equal(w.events.filter(e=>e.type==='KILL_LOOT').length,2);
});

test('combined lethal hits award spoils exactly once, independent of agent iteration order',()=>{
  const winners=[];for(const reverse of [false,true]){const w=make({population:2}),[a,c]=w.alive().filter(a=>a.tribe==='A'),b=w.alive().find(a=>a.tribe==='B');a.p=w.index(15,15);c.p=w.index(16,16);b.p=w.index(16,15);b.energy=2000;if(reverse)w.agents=Object.fromEntries(Object.entries(w.agents).reverse());stage(w);finish(w,{[a.id]:choose(w,a,'ATTACK',act=>act.target===b.id),[c.id]:choose(w,c,'ATTACK',act=>act.target===b.id)});const events=w.events.filter(e=>e.type==='KILL_LOOT');assert.equal(events.length,1);assert.equal(events[0].amount,19);assert.equal(a.energy+c.energy,2900);winners.push(events[0].actor);}assert.equal(...winners);
});

test('friendly kills never award loot when historical friendly fire is enabled',()=>{
  const w=make({population:2}),[a,b]=w.alive().filter(a=>a.tribe==='A');a.p=w.index(15,15);b.p=w.index(16,15);stage(w);finish(w,{[a.id]:choose(w,a,'ATTACK',act=>act.target===b.id)});assert.equal(b.alive,false);assert.equal(a.energy,500);assert.ok(!w.events.some(e=>e.type==='KILL_LOOT'));
});

test('prompts describe actual public claim costs, three-step ranges, reduced mines and enemy rewards',()=>{
  const w=new World(defaults);stage(w);for(const a of w.alive()){const rules=rulesFor(w,a,w.lastObservations[a.id]);assert.match(rules,/最多上下左右累计3步/);assert.match(rules,/横纵距离之和不超过3格/);assert.match(rules,/公账未预留余额支付5 E/);assert.match(rules,/额外生成10 E给占领者/);assert.ok(!rules.includes('任意位置的5×5视野至少覆盖'));assert.ok(!rules.includes('只有相邻时才能亲自攻击'));}
});

test('combat animation plays settled events once, expires, resets and hides other agents attacks in private view',()=>{
  const fx=new CombatEffects(),state={status:{episode:'test'},turn:0,combatEvents:[]};fx.update(state,0);const event={type:'ATTACK',result:'OK',actor:'A000',turn:1,from:[1,1],to:[3,2],damage:10,killed:true};state.turn=1;state.combatEvents=[event];fx.update(state,100);assert.equal(fx.effects.length,1);fx.update(state,200);assert.equal(fx.effects[0].start,100);
  const ctx=new Proxy({},{get:()=>()=>{},set:()=>true}),options={scale:20,colors:{A:'#ffa'},selected:'B001',privateView:true,observation:{turn:1,local_view:{cells:[{position:[1,1]},{position:[3,2]}]}}};assert.equal(fx.draw(ctx,600,options).painted,0);assert.equal(fx.draw(ctx,600,{...options,selected:'A000'}).painted,1);assert.equal(fx.draw(ctx,1600,options).active,false);state.turn=0;state.status.episode='new';fx.update(state,2000);assert.equal(fx.effects.length,0);
});
