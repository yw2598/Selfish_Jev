import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {World} from '../lib/world.mjs';
import {settle} from '../lib/settle.mjs';
import {candidates} from '../lib/actions.mjs';
import {mergeConfig,clone} from '../lib/util.mjs';
import {Simulation,rulesFor} from '../lib/policy.mjs';
import {applyNationalPolicy,policyRules} from '../lib/national-policy.mjs';
const defaults=JSON.parse(readFileSync(new URL('../defaults.json',import.meta.url),'utf8'));
Object.assign(defaults,{territoryTax:0,claimReward:0,contiguousExpansion:false});
const make=patch=>new World(mergeConfig(defaults,{population:1,resourceCount:0,startingMinePerTribe:false,decisionMode:'kev',...patch}));
function stage(w){w.prepare();for(const a of w.alive())w.lastObservations[a.id]=w.observation(a);}
function finish(w,decisions={}){settle(w,Object.fromEntries(w.alive().map(a=>[a.id,decisions[a.id]||{action:{type:'WAIT'}}])));assert.equal(w.lastConservation.error,0);}

test('default automatic 1 E payment happens after mine income and before survival without an action',()=>{
  const w=new World(defaults);assert.equal(w.config.subsistencePayment,1);assert.equal(w.config.nationalPolicyEnabled,true);stage(w);
  for(const a of w.alive()){assert.equal(a.energy,1100);assert.equal(w.lastObservations[a.id].self.energy,11);assert.ok(w.lastObservations[a.id].own_receipts.some(r=>r.type==='SUBSISTENCE'&&r.amount===1));}
  assert.equal(w.accounts.A,8500);assert.equal(w.metrics.A.lastSubsistencePaid,5);assert.equal(w.metrics.A.automaticIncome,60);finish(w);assert.ok(w.alive().every(a=>a.energy===1000));
});
test('insufficient balance plus actual mine income is shared to cents, order independently',()=>{
  const a=make({population:3}),b=make({population:3});b.agents=Object.fromEntries(Object.entries(b.agents).reverse());
  for(const w of [a,b]){w.accounts.A=31;w.resources[400]={stock:0,production:70,capacity:100,discovered:true};w.owners[400]='A';stage(w);assert.equal(w.accounts.A,0);assert.equal(w.metrics.A.lastSubsistencePaid,1.01);assert.deepEqual(w.alive().filter(a=>a.tribe==='A').map(a=>a.energy-1000).sort(),[33,34,34]);finish(w);}
  for(const id of Object.keys(a.agents))assert.equal(a.agents[id].energy,b.agents[id].energy);
});
test('zero balance cannot mint welfare; full capacity keeps unreceived money in treasury; dead receive nothing',()=>{
  const w=make({population:2}),members=w.alive().filter(a=>a.tribe==='A');members[0].energy=10000;members[1].alive=false;members[1].energy=0;w.accounts.B=0;const before=w.total();stage(w);assert.equal(w.accounts.A,3000);assert.equal(members[0].energy,10000);assert.equal(w.metrics.A.lastSubsistencePaid,0);assert.equal(w.metrics.B.lastSubsistencePaid,0);assert.equal(w.total(),before);finish(w);
});
test('subsistence takes priority over reserved grants and budgets without overspending',()=>{
  const w=make(),a=w.alive()[0];w.accounts.A=150;w.grants.g={id:'g',tribe:'A',member:a.id,remaining:100,effectiveTurn:1};w.projects.p={id:'p',tribe:'A',remaining:50,effectiveTurn:1,workers:[],p:20,type:'WALL'};
  stage(w);assert.equal(w.accounts.A,50);assert.equal(w.reserved('A'),50);assert.equal(w.grants.g.remaining+w.projects.p.remaining,50);assert.ok(w.events.some(e=>e.type==='RESERVATION_REDUCED'));finish(w);
});
test('newborns receive their first payment next turn and cannot resurrect already deceased agents',()=>{
  const w=make(),a=w.alive()[0];a.energy=3000;stage(w);const birth=candidates(w,a,w.lastObservations[a.id]).find(c=>c.action.type==='REPRODUCE');finish(w,{[a.id]:{action:birth.action}});const child=w.alive().find(a=>a.parents.length);assert.equal(child.energy,birth.action.amount);assert.equal(w.metrics.A.subsistencePaid,1);stage(w);assert.equal(child.energy,birth.action.amount+100);assert.equal(w.metrics.A.subsistencePaid,3);finish(w);
});
test('neutral and conservative policies both allow claims on unowned mines; only neutral rejects enemy mine capture',()=>{
  const w=make(),a=w.alive()[0];a.p=w.index(16,16);w.resources[a.p]={stock:0,capacity:10000,production:1000,discovered:false};
  for(const stance of ['NEUTRAL','CONSERVATIVE','AGGRESSIVE']){applyNationalPolicy(w,a.tribe,{action:{type:'SET_POLICY',stance}});w.owners[a.p]=null;assert.ok(candidates(w,a,w.observation(a)).some(c=>c.action.type==='CLAIM'));w.owners[a.p]='B';assert.equal(candidates(w,a,w.observation(a)).some(c=>c.action.type==='CLAIM'),stance!=='NEUTRAL');}
});
test('policy-aware combat defends friendly mines, avoids friendly fire and exposes retreat distances without hidden enemy data',()=>{
  const w=make({population:2}),a=w.alive()[0],friend=w.alive().find(b=>b.tribe==='A'&&b.id!==a.id),enemy=w.alive().find(b=>b.tribe==='B');a.p=w.index(16,16);friend.p=w.index(16,15);enemy.p=w.index(17,16);
  let leaves=candidates(w,a,w.observation(a));assert.ok(!leaves.some(c=>c.action.type==='ATTACK'));w.resources[w.index(15,16)]={stock:0,production:1000,capacity:10000};w.owners[w.index(15,16)]='A';
  leaves=candidates(w,a,w.observation(a));assert.ok(leaves.some(c=>c.action.type==='ATTACK'&&c.action.target===enemy.id));assert.ok(!leaves.some(c=>c.action.type==='ATTACK'&&c.action.target===friend.id));
  applyNationalPolicy(w,'A',{action:{type:'SET_POLICY',stance:'CONSERVATIVE'}});const o=w.observation(a);assert.match(policyRules(w,o),/主动探索、接近并占领无主矿区/);assert.ok(candidates(w,a,o).some(c=>c.action.type==='MOVE'&&c.description.includes('1→2')));
});
test('capturing an enemy mine pays a capture reward and switches next-turn income',()=>{
  const w=make({subsistencePayment:0}),a=w.alive()[0],p=w.index(16,16);a.p=p;w.resources[p]={stock:0,production:1000,capacity:10000,discovered:true};w.owners[p]='B';applyNationalPolicy(w,'A',{action:{type:'SET_POLICY',stance:'AGGRESSIVE'}});stage(w);assert.equal(w.accounts.B,4000);
  const claim=candidates(w,a,w.lastObservations[a.id]).find(c=>c.action.type==='CLAIM');finish(w,{[a.id]:{action:claim.action}});assert.equal(w.metrics.A.discoveryBonus,0);assert.equal(w.metrics.A.captureBonus,10);assert.equal(a.energy,1900);stage(w);assert.equal(w.accounts.A,3500);assert.equal(w.accounts.B,4000);finish(w);
});
test('king chooses policy separately, every unit gets same-turn orders, and each still makes a normal action',async()=>{
  const w=make({population:2}),sim=new Simulation(w),calls=[];sim.client.health=async()=>sim.client.modelInfo={run:'policy-test'};
  sim.client.choose=async payload=>{calls.push(clone(payload));const criteria=payload.questions.decision.criteria,phase=payload.state.observation.phase;const chosen=Object.entries(criteria).find(([,text])=>text.startsWith(phase==='NATIONAL_POLICY'?'保守':'等待'))?.[0]||Object.keys(criteria)[0];return {probabilities:Object.fromEntries(Object.keys(criteria).map(k=>[k,k===chosen?1:0])),raw:{},latencyMs:0};};
  const record=await sim.step();assert.equal(calls.filter(c=>c.state.observation.phase==='NATIONAL_POLICY').length,4);assert.equal(Object.keys(record.policyDecisions).length,4);assert.ok(Object.values(record.decisions).every(d=>d.action.type==='WAIT'));
  for(const o of Object.values(record.observations)){assert.equal(o.national_policy.stance,'CONSERVATIVE');assert.equal(o.national_policy.effective_turn,1);assert.equal(o.self.energy,11);if(o.role==='member')assert.ok(!('public_management'in o));}
  assert.ok(w.alive().every(a=>a.energy===1000));assert.equal(record.conservation.error,0);
});
test('policy failures retain the previous policy and mark the round invalid',async()=>{
  const w=make(),sim=new Simulation(w);sim.client.health=async()=>sim.client.modelInfo={run:'policy-test'};sim.client.choose=async payload=>{if(payload.state.observation.phase==='NATIONAL_POLICY')throw Error('policy unavailable');const criteria=payload.questions.decision.criteria,chosen=Object.entries(criteria).find(([,text])=>text.startsWith('等待'))[0];return {probabilities:Object.fromEntries(Object.keys(criteria).map(k=>[k,k===chosen?1:0])),raw:{},latencyMs:0};};
  const r=await sim.step();assert.equal(r.serviceFaults,4);assert.equal(r.validForEvaluation,false);assert.ok(Object.values(w.nationalPolicies).every(p=>p.stance==='NEUTRAL'));
});
