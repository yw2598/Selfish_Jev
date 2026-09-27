import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {World} from '../lib/world.mjs';
import {candidates} from '../lib/actions.mjs';
import {settle} from '../lib/settle.mjs';
import {rulesFor} from '../lib/policy.mjs';
import {mergeConfig} from '../lib/util.mjs';
import {legacyDefaults as defaults} from './fixtures.mjs';
// Isolate these pre-existing mechanics; subsistence/policy integration has its own suite.
defaults.subsistencePayment=0;defaults.nationalPolicyEnabled=false;
const world=patch=>new World(mergeConfig(defaults,{population:1,resourceCount:0,startingMinePerTribe:false,...patch}));
function stage(w){w.prepare();for(const a of w.alive())w.lastObservations[a.id]=w.observation(a);}
function decisions(w,parents,amount=1000){const d=Object.fromEntries(w.alive().map(a=>[a.id,{action:{type:'WAIT'}}]));for(const a of parents){const option=candidates(w,a,w.lastObservations[a.id]).find(l=>l.action.type==='REPRODUCE'&&l.action.amount===amount);assert.ok(option);assert.ok(!('target' in option.action));d[a.id]={action:option.action};}return d;}
function finish(w,d){settle(w,d);assert.equal(w.lastConservation.error,0);}
test('one isolated individual produces one child; investment is transferred and only one fee dissipates',()=>{
  const w=world(),a=w.alive()[0];stage(w);assert.equal(w.config.reproductionMode,'individual');
  assert.match(rulesFor(w,a,w.lastObservations[a.id]),/单体繁殖/);
  finish(w,decisions(w,[a]));const child=w.alive().find(a=>a.parents.length);
  assert.deepEqual(child.parents,[a.id]);assert.equal(child.tribe,a.tribe);assert.equal(child.energy,1000);assert.equal(a.energy,6400);assert.equal(child.age,0);assert.equal(w.distance(a.p,child.p),1);assert.deepEqual(child.memory,[]);
  stage(w);finish(w,decisions(w,[]));assert.equal(child.energy,900);assert.equal(child.age,1);
});
test('no available adjacent tile means no birth and no reproduction charge',()=>{
  const w=world(),a=w.alive()[0];a.p=w.index(16,16);for(const p of w.neighbors(a.p)){w.owners[p]=a.tribe;w.buildings[p]={type:'WALL',tribe:a.tribe,energy:3000,complete:true};}
  stage(w);finish(w,decisions(w,[a]));assert.equal(a.energy,7900);assert.equal(w.metrics.A.births,0);assert.equal(a.receipts.at(-1).result,'NO_BIRTH');
});
test('single parents contend for the last world slot deterministically without charging the loser',()=>{
  const runs=[];for(const reverse of [false,true]){const w=world({maxPopulation:5}),parents=w.alive().slice(0,2);if(reverse)w.agents=Object.fromEntries(Object.entries(w.agents).reverse());stage(w);finish(w,decisions(w,parents));assert.equal(w.alive().length,5);assert.deepEqual(parents.map(a=>a.energy).sort((a,b)=>a-b),[6400,7900]);runs.push(w.alive().find(a=>a.parents.length).parents);}
  assert.deepEqual(...runs);
});
test('a tribe cap blocks only that tribe and does not hide reproduction choices',()=>{
  const w=world({maxPopulationPerTribe:2}),a=w.alive()[0],b=w.alive()[1];const extra=w.newAgent('A',w.index(16,16),8000);w.registered.A.push(extra.id);stage(w);finish(w,decisions(w,[a,b]));assert.equal(w.metrics.A.births,0);assert.equal(w.metrics.B.births,1);assert.equal(a.energy,7900);assert.equal(b.energy,6400);
});
test('death before birth releases a population slot for a single parent',()=>{
  const w=world({maxPopulation:4}),a=w.alive()[0],dead=w.alive()[3];dead.energy=100;stage(w);finish(w,decisions(w,[a]));assert.equal(dead.alive,false);assert.equal(w.alive().length,4);assert.equal(w.metrics.A.births,1);
});
test('adjacent parents competing for one empty tile cannot place two newborns there',()=>{
  const w=world(),[a,b]=w.alive();a.p=w.index(14,16);b.p=w.index(16,16);const common=w.index(15,16);
  for(const parent of [a,b])for(const p of w.neighbors(parent.p))if(p!==common){w.owners[p]=parent.tribe;w.buildings[p]={type:'WALL',tribe:parent.tribe,energy:3000,complete:true};}
  stage(w);finish(w,decisions(w,[a,b]));const children=w.alive().filter(a=>a.parents.length);assert.equal(children.length,1);assert.equal(children[0].p,common);assert.deepEqual([a.energy,b.energy].sort((a,b)=>a-b),[6400,7900]);
});
