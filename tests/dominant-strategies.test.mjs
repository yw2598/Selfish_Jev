import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {World} from '../lib/world.mjs';
import {candidates,skillCandidates} from '../lib/actions.mjs';
import {Simulation} from '../lib/policy.mjs';
import {dominantDecision,strategyProfiles} from '../lib/dominant-strategies.mjs';
import {mergeConfig,clone,validateConfig} from '../lib/util.mjs';

const defaults=JSON.parse(readFileSync(new URL('../defaults.json',import.meta.url),'utf8'));
function make(patch={}){return new World(mergeConfig(defaults,{territoryTax:0,claimReward:0,contiguousExpansion:false,population:2,resourceCount:0,startingMinePerTribe:false,subsistencePayment:0,...patch}));}
function pick(w,a,observation=w.observation(a)){return dominantDecision(w.config,observation,candidates(w,a,observation));}
const member=(w,tribe)=>w.alive().find(a=>a.tribe===tribe&&a.id!==w.rulers[tribe]);

test('hybrid mode validates and old saves retain model-only decisions',()=>{
  assert.equal(defaults.decisionMode,'hybrid');assert.throws(()=>make({decisionMode:'unknown'}));const old=clone(defaults);delete old.decisionMode;assert.equal(validateConfig(old).decisionMode,'kev');
  assert.deepEqual(Object.values(strategyProfiles).map(p=>p.birthReserve),[26,20,14,10]);
});

test('an unambiguous full round needs neither Kev availability nor language generation',async()=>{
  const w=new World(defaults),sim=new Simulation(w);let calls=0;
  sim.client.health=async()=>{calls++;throw Error('must not check Kev');};sim.client.choose=async()=>{calls++;throw Error('must not call Kev');};sim.language.json=async()=>{calls++;throw Error('must not call language');};
  const record=await sim.step();assert.equal(calls,0);assert.equal(record.requests,0);assert.equal(record.routing.rule,24);assert.equal(record.routing.fallback,0);assert.equal(record.serviceFaults,0);assert.equal(record.conservation.error,0);
  for(const d of Object.values(record.decisions)){assert.equal(d.source,'dominant-rule');assert.deepEqual(d.trace,[]);assert.ok(d.ruleId);}
  assert.equal(w.runtime.routing.rule,24);
});

test('low energy members actually withdraw their authorized allocation before optional actions',()=>{
  const w=make(),a=member(w,'A');a.energy=400;w.grants.g={id:'g',tribe:'A',member:a.id,remaining:2000,effectiveTurn:0};const result=pick(w,a);assert.equal(result.decision.action.mode,'WITHDRAW');assert.equal(result.decision.action.amount,2000);
});

test('rulers authorize themselves before becoming too poor to administer public funds',()=>{
  const w=make(),r=w.agents[w.rulers.A];w.accounts.A=8500;const result=pick(w,r);assert.equal(result.decision.ruleId,'self-authorization');assert.equal(result.decision.action.member,r.id);assert.ok(result.decision.action.amount<8500);
});

test('rulers can process a delivered request from a registered member outside current view',()=>{
  const w=make(),r=w.agents[w.rulers.A],a=member(w,'A');r.energy=4000;w.accounts.A=8500;a.p=w.index(12,12);const o=w.observation(r);assert.ok(!o.territory_live_view.observed_agents.some(b=>b.id===a.id));
  o.communication_context.recent_raw=[{sender_id:a.id,sent_turn:0,value:{balance_band:'LOW'}}];const result=pick(w,r,o);assert.equal(result.decision.ruleId,'requested-authorization');assert.equal(result.decision.action.member,a.id);
});

test('A preserves its higher birth reserve while D reproduces with the same private balance',()=>{
  const outcomes=[];for(const tribe of ['A','D']){const w=make(),a=member(w,tribe);a.p=w.index(12,12);a.energy=3500;w.resources[a.p]={stock:0,capacity:10000,production:1000,discovered:true};w.owners[a.p]=tribe;outcomes.push(pick(w,a).decision.ruleId);}
  assert.notEqual(outcomes[0],'reproduce');assert.equal(outcomes[1],'reproduce');
});

test('first claim of a visible neutral mine is preferred to empty-land expansion',()=>{
  const w=make(),a=member(w,'B');a.p=w.index(12,12);w.resources[a.p]={stock:0,production:1000,capacity:10000,discovered:false};const result=pick(w,a);assert.equal(result.decision.ruleId,'claim-mine');assert.equal(result.decision.action.type,'CLAIM');
  delete w.resources[a.p];assert.notEqual(pick(w,a).decision.action.type,'CLAIM');
});

test('rules remain independent of hidden enemy balances and hidden treasury funds',()=>{
  const w=make(),a=member(w,'A'),enemy=w.alive().find(a=>a.tribe==='B');a.p=w.index(12,12);const o=w.observation(a),leaves=candidates(w,a,o),before=dominantDecision(w.config,o,leaves);enemy.energy=9999;w.accounts.A=0;w.accounts.B=999999;
  assert.deepEqual(dominantDecision(w.config,o,leaves),before);assert.equal(before.decision.observationHash,dominantDecision(w.config,clone(o),clone(leaves)).decision.observationHash);
});

test('supply versus immediate combat conflict and contradictory reports request real Kev fallback',()=>{
  const w=make(),a=member(w,'A'),b=w.alive().find(a=>a.tribe==='B');a.p=w.index(12,12);b.p=w.index(13,12);a.energy=500;w.grants.g={id:'g',tribe:'A',member:a.id,remaining:2000,effectiveTurn:0};assert.match(pick(w,a).fallbackReason,/补给与交战冲突/);
  b.p=w.index(21,21);const o=w.observation(a);o.communication_context.recent_raw=[{sender_id:w.rulers.A,sent_turn:0,value:{balance_band:'LOW'}},{sender_id:w.rulers.A,sent_turn:0,value:{balance_band:'HIGH'}}];assert.match(pick(w,a,o).fallbackReason,/申报互相矛盾/);
});

test('repeated failed movement requests reconsideration rather than looping a fixed rule',()=>{
  const w=make(),a=member(w,'C'),o=w.observation(a);o.own_receipts=[{type:'MOVE',result:'MOVE_CONFLICT',observed_turn:0},{type:'MOVE',result:'MOVE_BLOCKED',observed_turn:0}];assert.match(pick(w,a,o).fallbackReason,/连续行动失败/);
});

test('hybrid conflicts reach Kev with explicit context, while other agents still use rules',async()=>{
  const w=make(),a=member(w,'A');a.receipts=[{type:'MOVE',result:'MOVE_CONFLICT',observed_turn:0,available_turn:0},{type:'MOVE',result:'MOVE_BLOCKED',observed_turn:0,available_turn:0}];const sim=new Simulation(w);let health=0,calls=0;
  sim.client.health=async()=>{health++;return sim.client.modelInfo={run:'fallback-test'};};
  sim.client.choose=async payload=>{calls++;assert.match(payload.state.observation.strategy_context.fallback_reason,/连续行动失败/);const criteria=payload.questions.decision.criteria,selected=Object.entries(criteria).find(([,text])=>text.startsWith('等待'))?.[0]||Object.keys(criteria)[0];return {probabilities:Object.fromEntries(Object.keys(criteria).map(k=>[k,k===selected?1:0])),raw:{},latencyMs:0};};
  const r=await sim.step();assert.equal(health,1);assert.ok(calls>0);assert.equal(r.decisions[a.id].source,'kev-fallback');assert.equal(r.decisions[a.id].action.type,'WAIT');assert.equal(r.routing.fallback,1);assert.ok(r.routing.rule>0);assert.equal(r.serviceFaults,0);assert.equal(r.conservation.error,0);
});

test('failed Kev fallback is explicitly marked as a fault, never disguised as a successful rule',async()=>{
  const w=make(),a=member(w,'A');a.receipts=[{type:'MOVE',result:'MOVE_BLOCKED',observed_turn:0,available_turn:0},{type:'MOVE',result:'MOVE_CONFLICT',observed_turn:0,available_turn:0}];const sim=new Simulation(w);sim.client.health=async()=>{throw Error('offline-test');};const r=await sim.step();assert.equal(r.decisions[a.id].source,'kev-fallback');assert.equal(r.decisions[a.id].fault,'offline-test');assert.equal(r.validForEvaluation,false);assert.equal(r.routing.faults,1);
});

test('custom objective weights are delegated to Kev instead of silently applying the original tribe profile',()=>{
  const w=make({selfWeights:{A:.5}}),a=member(w,'A');assert.match(pick(w,a).fallbackReason,/自定义目标权重/);
});

test('skill choices are legal, deterministic and follow each profile without a model call',()=>{
  const w=make(),a=member(w,'D');a.opportunities=2;let o=w.observation(a),result=dominantDecision(w.config,o,skillCandidates(w,a),'SKILL_UPGRADE');assert.equal(result.decision.action.skill,'S1');a.skills.S1=3;o=w.observation(a);result=dominantDecision(w.config,o,skillCandidates(w,a),'SKILL_UPGRADE');assert.equal(result.decision.action.skill,'P3');
});

test('twenty hybrid rounds keep legal actions, grant withdrawals and energy conservation on the smaller board',async()=>{
  const w=new World(mergeConfig(defaults,{language:{endpoint:''}})),sim=new Simulation(w);let rules=0,fallbacks=0;
  sim.client.health=async()=>sim.client.modelInfo={run:'offline-regression-only'};
  sim.client.choose=async payload=>{const criteria=payload.questions.decision.criteria,selected=Object.entries(criteria).find(([,text])=>text.startsWith('等待'))?.[0]||Object.keys(criteria)[0];return {probabilities:Object.fromEntries(Object.keys(criteria).map(k=>[k,k===selected?1:0])),raw:{},latencyMs:0};};
  for(let i=0;i<20;i++){const record=await sim.step();assert.equal(record.conservation.error,0);assert.equal(record.serviceFaults,0);rules+=record.routing.rule;fallbacks+=record.routing.fallback;}
  assert.ok(rules>fallbacks*4);assert.ok(Object.values(w.metrics).some(m=>m.withdrawn>0));assert.ok(w.alive().length>=20);
});
