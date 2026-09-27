import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {World} from '../lib/world.mjs';
import {candidates,skillCandidates} from '../lib/actions.mjs';
import {settle} from '../lib/settle.mjs';
import {mergeConfig} from '../lib/util.mjs';
import {scenario,importScenario,editMap} from '../lib/editor.mjs';
import {rulesFor} from '../lib/policy.mjs';
import {legacyDefaults as defaults} from './fixtures.mjs';
// Isolate these pre-existing mechanics; subsistence/policy integration has its own suite.
defaults.subsistencePayment=0;defaults.nationalPolicyEnabled=false;
function stage(w){w.prepare();for(const a of w.alive())w.lastObservations[a.id]=w.observation(a);}
function act(w,byId={}){const d=Object.fromEntries(w.alive().map(a=>[a.id,byId[a.id]||{action:{type:'WAIT'}}]));settle(w,d);assert.equal(w.lastConservation.error,0);}
function claim(w,a){return {action:candidates(w,a,w.lastObservations[a.id]).find(l=>l.action.type==='CLAIM').action};}
function neutral(){const w=new World(mergeConfig(defaults,{population:1,resourceCount:0,startingMinePerTribe:false}));const a=w.alive()[0];a.p=w.index(16,16);w.resources[a.p]={stock:5000,capacity:10000,production:1000,discovered:false};return {w,a,p:a.p};}
test('starting mines automatically transfer inventory and recurring production into public accounts',()=>{
  const w=new World(defaults);stage(w);assert.equal(w.accounts.A,26000);assert.equal(w.metrics.A.automaticIncome,60);assert.equal(w.injected,Object.keys(w.resources).length*1000);assert.equal(w.metrics.A.discoveryBonus,0);assert.ok(Object.entries(w.resources).every(([p,r])=>w.owners[p]===null?r.stock===6000&&!r.discovered:r.stock===0&&r.discovered));
  assert.ok(!candidates(w,w.alive()[0],w.lastObservations[w.alive()[0].id]).some(l=>l.action.type==='HARVEST'));act(w);stage(w);assert.equal(w.accounts.A,27000);assert.equal(w.metrics.A.automaticIncome,70);act(w);
});
test('first claimant receives newly generated 50 E once, auto income starts next turn',()=>{
  const {w,a,p}=neutral();a.energy=3000;stage(w);assert.equal(w.accounts.A,20000);const before=w.total();act(w,{[a.id]:claim(w,a)});assert.equal(a.energy,7700);assert.equal(w.metrics.A.discoveryBonus,50);assert.equal(w.lastConservation.injected,60);assert.equal(w.resources[p].stock,6000);assert.equal(w.accounts.A,20000);assert.ok(w.total()>before);
  stage(w);assert.equal(w.accounts.A,27000);assert.equal(w.resources[p].stock,0);assert.equal(w.metrics.A.automaticIncome,70);act(w);
});
test('reward overflow reaches the public account and capture by another tribe never mints a second reward',()=>{
  const {w,a,p}=neutral();stage(w);act(w,{[a.id]:claim(w,a)});assert.equal(a.energy,10000);assert.equal(w.accounts.A,22700);
  const b=w.alive().find(x=>x.tribe==='B');a.p=w.index(15,16);b.p=p;stage(w);const oldB=w.accounts.B;act(w,{[b.id]:claim(w,b)});assert.equal(w.accounts.B,oldB);assert.equal(w.metrics.B.discoveryBonus,0);assert.equal(w.lastConservation.injected,10);
  stage(w);assert.equal(w.accounts.B,oldB+1000);act(w);
});
test('an isolated occupied mine needs no connected supply line and accounts survive extinction',()=>{
  const {w,a,p}=neutral();w.owners[p]='B';w.resources[p].discovered=true;const b=w.alive().find(x=>x.tribe==='B');b.energy=100;
  stage(w);act(w);assert.equal(b.alive,false);const balance=w.accounts.B;stage(w);assert.equal(w.accounts.B,balance+1000);act(w);
});
test('map export/import and repaint preserve a mine reward already consumed',()=>{
  const {w,a,p}=neutral();stage(w);act(w,{[a.id]:claim(w,a)});const imported=new World(w.config);importScenario(imported,scenario(w));assert.equal(imported.resources[p].discovered,true);
  editMap(imported,[{p,tool:'territory',tribe:null},{p,tool:'resource',tribe:null}]);assert.equal(imported.resources[p].discovered,true);
});
test('automatic mining excludes obsolete harvest skills and makes transfer efficiency available directly',()=>{
  const w=new World(defaults),a=w.alive()[0];a.opportunities=1;const ids=skillCandidates(w,a).map(c=>c.action.skill);assert.ok(!ids.includes('P1')&&!ids.includes('P2'));assert.ok(ids.includes('P3'));
});
test('all four strategies and both roles receive extinction failure and automatic-income rules without hidden counts',()=>{
  const w=new World(defaults);stage(w);for(const a of w.alive()){
    const o=w.lastObservations[a.id],rules=rulesFor(w,a,o);assert.match(rules,/本族最后一个存活个体死亡，本族立即失败/);assert.match(rules,/即使个人目标权重为1/);assert.match(rules,/自动进入本族公共池/);assert.match(rules,/单体繁殖/);assert.ok(!rules.includes('{resource_rules}')&&!rules.includes('{survival_constraint}'));assert.equal(o.objective.failure_condition,'TRIBE_EXTINCTION');assert.ok(!('population'in o.objective));
  }
});
