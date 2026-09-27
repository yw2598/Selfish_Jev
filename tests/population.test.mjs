import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {World} from '../lib/world.mjs';
import {candidates} from '../lib/actions.mjs';
import {settle} from '../lib/settle.mjs';
import {mergeConfig,clone,validateConfig,tribes} from '../lib/util.mjs';
import {applyConfig} from '../lib/editor.mjs';
import {rulesFor} from '../lib/policy.mjs';

import {legacyDefaults as defaults} from './fixtures.mjs';
// Isolate these pre-existing mechanics; subsistence/policy integration has its own suite.
defaults.subsistencePayment=0;defaults.nationalPolicyEnabled=false;
function makeWorld(counts){
  const w=new World(mergeConfig(defaults,{population:1,resourceCount:0,startingMinePerTribe:false,reproductionMode:'paired',miningMode:'manual'}));let p=0;
  for(const tribe of tribes){while(w.alive().filter(a=>a.tribe===tribe).length<counts[tribe]){while(w.alive().some(a=>a.p===p))p++;const a=w.newAgent(tribe,p++,8000);w.registered[tribe].push(a.id);}}
  // Keep filler population far from the paired parents and their birth cells.
  w.alive().forEach((a,i)=>a.p=w.index(1+i%20,1+Math.floor(i/20)));
  return w;
}
function pairsOf(w,tribe,count){const members=w.alive().filter(a=>a.tribe===tribe);const pairs=[];for(let i=0;i<count;i++){const a=members[i*2],b=members[i*2+1],x=12+i*6,y=12+tribes.indexOf(tribe)*4;a.p=w.index(x,y);b.p=w.index(x+1,y);pairs.push([a,b]);}return pairs;}
function stage(w){w.prepare();for(const a of w.alive())w.lastObservations[a.id]=w.observation(a);}
function birthDecisions(w,pairs){const intents=Object.fromEntries(w.alive().map(a=>[a.id,{action:{type:'WAIT'}}]));for(const [a,b] of pairs)for(const [parent,partner] of [[a,b],[b,a]]){const option=candidates(w,parent,w.lastObservations[parent.id]).find(c=>c.action.type==='REPRODUCE'&&c.action.target===partner.id&&c.action.amount===1000);assert.ok(option);intents[parent.id]={action:clone(option.action)};}return intents;}
function checkLimits(w){assert.ok(w.alive().length<=100);for(const tribe of tribes)assert.ok(w.alive().filter(a=>a.tribe===tribe).length<=50);assert.equal(w.lastConservation.error,0);}

test('legacy full-density layout creates a 32-square map with five per tribe and 53 mines',()=>{const w=new World(defaults);assert.equal(w.config.width,32);assert.equal(w.config.height,32);assert.equal(w.alive().length,20);for(const tribe of tribes)assert.equal(w.alive().filter(a=>a.tribe===tribe).length,5);assert.equal(Object.keys(w.resources).length,53);assert.equal(w.config.maxPopulation,100);assert.equal(w.config.maxPopulationPerTribe,50);});
test('each starting territory has one connected producing mine under every rotation',()=>{
  for(const rotation of [0,1,2,3]){
    const w=new World(mergeConfig(defaults,{rotation,miningMode:'manual',terrainMode:'plain',neutralMineLayout:'legacy'}));
    for(const tribe of tribes){
      const stats=w.statistics().tribes.find(s=>s.tribe===tribe);assert.equal(stats.controlledResources,1);assert.equal(stats.effectiveProduction,10);
      const mine=Number(Object.keys(w.resources).find(p=>w.owners[p]===tribe)),net=w.networks();
      assert.ok(w.alive().filter(a=>a.tribe===tribe).every(a=>net.byTile[a.p]===net.byTile[mine]));
    }
    for(let turn=0;turn<7;turn++){
      const before=w.total();w.prepare();assert.equal(w.injected,turn<5?4000:0);
      for(const r of Object.values(w.resources))assert.equal(r.stock,Math.min(10000,5000+1000*(turn+1)));
      settle(w,Object.fromEntries(w.alive().map(a=>[a.id,{action:{type:'WAIT'}}])));assert.equal(w.lastConservation.error,0);assert.ok(w.total()<=before+4000);
    }
  }
});
test('guaranteed mines count toward total resources and legacy worlds retain their initial layout',()=>{
  const w=new World(mergeConfig(defaults,{resourceCount:7}));assert.equal(Object.keys(w.resources).length,7);assert.equal(Object.keys(w.resources).filter(p=>w.owners[p]===null).length,3);
  assert.throws(()=>new World(mergeConfig(defaults,{resourceCount:3})),/至少4/);
  const legacy=clone(defaults);delete legacy.startingMinePerTribe;const old=new World(legacy);assert.ok(Object.keys(old.resources).every(p=>old.owners[p]===null));
  assert.throws(()=>applyConfig(w,{startingMinePerTribe:false}),/新建实验/);
});
test('a full world prevents birth, does not charge parents, and preserves legal candidates',()=>{
  const w=makeWorld({A:25,B:25,C:25,D:25}),pairs=pairsOf(w,'A',1);stage(w);
  const before=candidates(w,pairs[0][0],w.lastObservations[pairs[0][0].id]).map(c=>c.action);
  const remote=w.alive().find(a=>a.tribe==='D');remote.alive=false;
  assert.deepEqual(candidates(w,pairs[0][0],w.lastObservations[pairs[0][0].id]).map(c=>c.action),before);remote.alive=true;
  settle(w,birthDecisions(w,pairs));assert.equal(w.alive().length,100);assert.equal(w.metrics.A.births,0);for(const a of pairs.flat())assert.equal(a.energy,7900);checkLimits(w);
});
test('a tribe at 50 cannot give birth while other tribes still can',()=>{
  const w=makeWorld({A:50,B:2,C:1,D:1}),aPair=pairsOf(w,'A',1),bPair=pairsOf(w,'B',1);stage(w);settle(w,birthDecisions(w,[...aPair,...bPair]));
  assert.equal(w.alive().filter(a=>a.tribe==='A').length,50);assert.equal(w.metrics.A.births,0);assert.equal(w.metrics.B.births,1);assert.equal(w.alive().length,55);for(const a of aPair.flat())assert.equal(a.energy,7900);checkLimits(w);
});
test('simultaneous pairs across tribes compete for exactly one remaining world slot',()=>{
  const w=makeWorld({A:25,B:25,C:25,D:24}),pairs=[...pairsOf(w,'A',1),...pairsOf(w,'B',1)];stage(w);settle(w,birthDecisions(w,pairs));
  assert.equal(w.alive().length,100);assert.equal(tribes.reduce((n,t)=>n+w.metrics[t].births,0),1);assert.deepEqual(pairs.flat().map(a=>a.energy).sort((a,b)=>a-b),[6400,6400,7900,7900]);checkLimits(w);
});
test('the last tribal slot is allocated once, independent of agent iteration order',()=>{
  const a=makeWorld({A:49,B:1,C:1,D:1}),b=makeWorld({A:49,B:1,C:1,D:1});const ap=pairsOf(a,'A',2),bp=pairsOf(b,'A',2);b.agents=Object.fromEntries(Object.entries(b.agents).reverse());
  for(const [w,pairs] of [[a,ap],[b,bp]]){stage(w);settle(w,birthDecisions(w,pairs));assert.equal(w.alive().filter(a=>a.tribe==='A').length,50);assert.equal(w.metrics.A.births,1);checkLimits(w);}
  assert.deepEqual(a.alive().find(a=>a.parents.length).parents,b.alive().find(a=>a.parents.length).parents);
});
test('death earlier in the round frees one slot for a newborn',()=>{
  const w=makeWorld({A:25,B:25,C:25,D:25}),pairs=pairsOf(w,'A',1),dead=w.alive().find(a=>a.tribe==='D');dead.energy=100;
  stage(w);settle(w,birthDecisions(w,pairs));assert.equal(dead.alive,false);assert.equal(w.metrics.A.births,1);assert.equal(w.alive().length,100);assert.equal(w.alive().find(a=>a.parents.length).age,0);checkLimits(w);
});
test('invalid starting population, direct extra spawns, and lowering below live population are rejected',()=>{
  assert.throws(()=>validateConfig(mergeConfig(defaults,{population:26})),/初始人口/);
  assert.throws(()=>validateConfig(mergeConfig(defaults,{maxPopulationPerTribe:4})),/初始人口/);
  assert.throws(()=>validateConfig(mergeConfig(defaults,{maxPopulation:0})),/整数/);
  const w=makeWorld({A:50,B:2,C:1,D:1});assert.throws(()=>w.newAgent('A',3000,8000),/人口上限/);
  assert.throws(()=>applyConfig(w,{maxPopulation:53}),/当前存活人口/);assert.throws(()=>applyConfig(w,{maxPopulationPerTribe:49}),/当前存活人口/);assert.equal(w.config.maxPopulation,100);
});
test('both roles receive static population caps, without hidden live counts',()=>{
  const w=new World(defaults);stage(w);for(const a of [w.agents[w.rulers.A],w.alive().find(a=>a.tribe==='A'&&a.id!==w.rulers.A)]){const rules=rulesFor(w,a,w.lastObservations[a.id]);assert.match(rules,/总人口上限为100/);assert.match(rules,/本族存活人口上限为50/);assert.ok(!rules.includes('{max_population'));assert.ok(!('population' in w.lastObservations[a.id]));}
});
