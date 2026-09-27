import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {World} from '../lib/world.mjs';
import {mergeConfig} from '../lib/util.mjs';
import {isLand,terrainTypes} from '../lib/terrain.mjs';
import {scenario,importScenario} from '../lib/editor.mjs';
import {compactObservation,rulesFor} from '../lib/policy.mjs';
import {candidates} from '../lib/actions.mjs';
import {legacyDefaults as defaults} from './fixtures.mjs';
// Isolate these pre-existing mechanics; subsistence/policy integration has its own suite.
defaults.subsistencePayment=0;defaults.nationalPolicyEnabled=false;

test('neutral mines cover every exterior 5x5 view, including borders, across seeds and sizes',()=>{
  for(const [width,height]of [[32,32],[64,32],[64,64],[128,128],[256,256]])for(const seed of [1,20260927]){
    const w=new World(mergeConfig(defaults,{width,height,seed})),mines=new Set(Object.keys(w.resources).filter(p=>w.owners[p]===null).map(Number));
    for(let p=0;p<w.owners.length;p++)if(w.owners[p]===null)assert.ok(w.square(p,2).some(q=>mines.has(q)),`no mine near ${width}/${seed}/${p}`);
    for(const p of Object.keys(w.resources))assert.ok(isLand(w.biomes[p]));
    for(const tribe of ['A','B','C','D'])assert.equal(Object.keys(w.resources).filter(p=>w.owners[p]===tribe).length,1);
    assert.deepEqual(new World(w.config).resources,w.resources);assert.deepEqual(new World(w.config).biomes,w.biomes);
  }
});
test('visual water and mountains remain legal movement, construction and birth tiles',()=>{
  const w=new World(mergeConfig(defaults,{population:1,resourceCount:0,startingMinePerTribe:false})),a=w.alive()[0];
  for(const biome of ['WATER','MOUNTAIN']){
    a.p=w.index(15,15);const p=w.index(16,15);w.biomes[p]=biome;w.owners[p]=a.tribe;
    const o=w.observation(a),leaves=candidates(w,a,o);
    assert.ok(w.passable(p,a.tribe));assert.ok(leaves.some(l=>l.action.type==='MOVE'&&l.action.p===p));assert.ok(leaves.some(l=>l.action.type==='BUILD'&&l.action.p===p));assert.ok(leaves.some(l=>l.action.type==='REPRODUCE'));
    assert.equal(o.local_view.cells.find(c=>c.position[0]===16&&c.position[1]===15).terrain,'PLAIN');
  }
});
test('terrain export/import and row encoding preserve visual information without expanding visibility',()=>{
  const w=new World(defaults),v=new World(defaults),data=scenario(w);importScenario(v,data);assert.deepEqual(v.biomes,w.biomes);assert.ok(terrainTypes.every(t=>w.biomes.includes(t)));
  const o=w.observation(w.alive()[0]),compact=compactObservation(o);
  const restored=compact.local_view.plain_tile_runs.rows.flatMap(([y,x0,x1,owner,biome])=>Array.from({length:x1-x0+1},(_,i)=>[x0+i,y,owner,biome]));
  assert.deepEqual(restored,o.local_view.cells.map(c=>[...c.position,c.owner_tribe,c.biome]));
  assert.throws(()=>importScenario(v,{...data,biomes:['WATER']}),/外观地形/);
  data.biomes[0]='INVALID';assert.throws(()=>importScenario(v,data),/外观地形/);
});
test('all tribes and roles get the configurable exploration preference with unchanged weights',()=>{
  const w=new World(defaults);for(const a of w.alive()){
    const o=w.observation(a),r=rulesFor(w,a,o);assert.match(r,/探索倾向（温和）/);assert.match(r,/不能据此断言未知坐标/);assert.match(r,/低能量时先考虑可行补给/);assert.ok(!r.includes('{exploration_rules}'));assert.ok(!r.includes('共享资源仍需HARVEST'));
    assert.equal(o.objective.self_weight,defaults.selfWeights[a.tribe]);
  }
  w.config.explorationTendency='none';assert.ok(!rulesFor(w,w.alive()[0],w.observation(w.alive()[0])).includes('探索倾向（'));
});
