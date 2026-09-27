import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {World} from '../lib/world.mjs';
import {settle} from '../lib/settle.mjs';
import {candidates} from '../lib/actions.mjs';
import {mergeConfig,validateConfig,clone} from '../lib/util.mjs';
import {dominantDecision} from '../lib/dominant-strategies.mjs';
import {MovementEffects} from '../public/movement-effects.js';
import {rulesFor} from '../lib/policy.mjs';
const defaults=JSON.parse(readFileSync(new URL('../defaults.json',import.meta.url),'utf8'));
const make=(patch={})=>new World(mergeConfig(defaults,{population:1,resourceCount:0,startingMinePerTribe:false,subsistencePayment:0,...patch}));
function stage(w){w.prepare();for(const a of w.alive())w.lastObservations[a.id]=w.observation(a);}
function finish(w,actions={}){settle(w,Object.fromEntries(w.alive().map(a=>[a.id,{action:actions[a.id]||{type:'WAIT'}}])));assert.equal(w.lastConservation.error,0);}

test('land costs 5 public E, independently mints 1 personal E and starts tax next turn',()=>{
  const w=make(),a=w.alive()[0];a.p=w.index(7,4);stage(w);assert.equal(w.accounts.A,3360);assert.equal(w.metrics.A.territoryIncome,3.6);
  finish(w,{[a.id]:{type:'CLAIM',p:a.p}});assert.equal(w.accounts.A,2860);assert.equal(a.energy,1000);assert.equal(w.lastConservation.injected,15.4);assert.equal(w.metrics.A.claimBonus,1);
  stage(w);assert.equal(w.accounts.A,3230);assert.equal(w.events.find(e=>e.type==='TERRITORY_TAX'&&e.tribe==='A').amount,3.7);finish(w);
});
test('tax is available for the same round welfare and captures transfer future tax',()=>{
  const w=make({publicEnergy:0,subsistencePayment:1}),a=w.alive()[0];stage(w);assert.equal(w.metrics.A.lastSubsistencePaid,1);assert.equal(w.accounts.A,260);finish(w);
  const q=make({territoryTax:.1}),b=q.alive().find(a=>a.tribe==='B');b.p=q.index(4,4);stage(q);finish(q,{[b.id]:{type:'CLAIM',p:b.p}});stage(q);
  assert.equal(q.events.find(e=>e.type==='TERRITORY_TAX'&&e.tribe==='A').amount,3.5);assert.equal(q.events.find(e=>e.type==='TERRITORY_TAX'&&e.tribe==='B').amount,3.7);finish(q);
});
test('scarce public funding only rewards successful claims, no repeat reward for own land',()=>{
  const w=make({population:2,publicEnergy:5,territoryTax:0}),agents=w.alive().filter(a=>a.tribe==='A');agents.forEach((a,i)=>a.p=w.index(7,3+i));stage(w);finish(w,Object.fromEntries(agents.map(a=>[a.id,{type:'CLAIM',p:a.p}])));
  assert.equal(w.accounts.A,0);assert.equal(w.metrics.A.claimBonus,1);assert.equal(w.events.filter(e=>e.type==='CLAIM_REWARD').length,1);assert.equal(w.events.filter(e=>e.type==='CLAIM'&&e.result==='PUBLIC_FUNDS_INSUFFICIENT').length,1);
  const claimed=agents.find(a=>w.owners[a.p]==='A');stage(w);assert.ok(!candidates(w,claimed,w.lastObservations[claimed.id]).some(l=>l.action.type==='CLAIM'));finish(w);assert.equal(w.metrics.A.claimBonus,1);
});
test('claim reward overflows to public funds and stacks with first mine reward',()=>{
  const w=make({territoryTax:0,survivalCost:0}),a=w.alive()[0];a.energy=10000;a.p=w.index(8,8);stage(w);finish(w,{[a.id]:{type:'CLAIM',p:a.p}});assert.equal(a.energy,10000);assert.equal(w.accounts.A,2600);assert.equal(w.lastConservation.injected,1);
  const m=make({territoryTax:0}),b=m.alive()[0];b.p=m.index(8,8);m.resources[b.p]={stock:0,production:0,capacity:10000,discovered:false};stage(m);finish(m,{[b.id]:{type:'CLAIM',p:b.p}});assert.equal(b.energy,2000);assert.equal(m.metrics.A.claimBonus,1);assert.equal(m.metrics.A.discoveryBonus,10);assert.equal(m.lastConservation.injected,11);
});
test('legacy saves keep taxes and land rewards disabled and amounts validate',()=>{
  const c=clone(defaults);for(const k of ['territoryTax','claimReward','contiguousExpansion'])delete c[k];validateConfig(c);assert.equal(c.territoryTax,0);assert.equal(c.claimReward,0);assert.equal(c.contiguousExpansion,false);
  for(const patch of [{territoryTax:-1},{claimReward:.001},{contiguousExpansion:1}])assert.throws(()=>make(patch));
});
test('all factions fill connected empty borders without changing neutral mine eligibility',()=>{
  for(const tribe of ['A','B','C','D']){const w=make(),a=w.alive().find(a=>a.tribe===tribe);w.owners.fill(null);a.p=w.index(10,10);w.owners[w.index(9,10)]=tribe;stage(w);const o=w.observation(a),d=dominantDecision(w.config,o,candidates(w,a,o));assert.equal(d.decision.ruleId,'claim-frontier');assert.equal(d.decision.action.type,'CLAIM');assert.match(rulesFor(w,a,o),/0.1 E地税/);assert.match(rulesFor(w,a,o),/上下左右接壤/);}
  const w=make(),a=w.alive()[0];w.owners.fill(null);a.p=w.index(10,10);a.energy=3000;w.owners[a.p]='A';stage(w);const o=w.observation(a),d=dominantDecision(w.config,o,candidates(w,a,o));assert.equal(d.decision.ruleId,'connect-frontier');assert.equal(w.distance(a.p,d.decision.action.p),1);
});
test('successful movement exports the traversable bent path and plays once per round',()=>{
  const w=make({territoryTax:0}),a=w.alive()[0];a.p=w.index(10,10);w.buildings[w.index(11,10)]={tribe:'B',type:'WALL',complete:true,energy:3000};const before={...w.exportState(),status:{episode:'test'}};stage(w);finish(w,{[a.id]:{type:'MOVE',p:w.index(11,11)}});
  const state={...w.exportState(),status:{episode:'test'}},e=state.movementEvents[0];assert.deepEqual(e.path,[[10,10],[10,11],[11,11]]);
  const fx=new MovementEffects();fx.update(before,0);fx.update(state,100);assert.deepEqual(fx.position(a,24,100),[10,10]);const mid=fx.position(a,24,495);assert.deepEqual(mid,[10,11]);fx.update(state,500);assert.equal(fx.moves.size,1);assert.deepEqual(fx.position(a,24,1000),[11,11]);assert.equal(fx.moves.size,0);
  fx.update({...state,turn:2,status:{episode:'new'}},1100);assert.equal(fx.moves.size,0);const reduced=new MovementEffects({reducedMotion:true});reduced.update(before,0);reduced.update(state,100);assert.equal(reduced.moves.size,0);
});
