import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {World} from '../lib/world.mjs';
import {settle} from '../lib/settle.mjs';
import {scenario,applyConfig,editMap} from '../lib/editor.mjs';
import {clone} from '../lib/util.mjs';
import {buildReplay,majorEvents} from '../lib/replay-builder.mjs';
import {ReplayStore} from '../lib/replay-store.mjs';
import {normalizeClips,highlights,timeline,locate} from '../public/replay-timeline.js';
import {finalizeWebM} from '../public/webm-duration.js';
import {roundSummary} from '../lib/replay-events.mjs';
import {replayReport} from '../public/replay-report.js';
const defaults=JSON.parse(readFileSync(new URL('../defaults.json',import.meta.url),'utf8'));
async function temporary(fn){const dir=await mkdtemp(path.join(tmpdir(),'selfish-replay-'));try{return await fn(dir);}finally{if(!path.resolve(dir).startsWith(path.resolve(tmpdir())+path.sep+'selfish-replay-'))throw Error('Unsafe cleanup target');await rm(dir,{recursive:true,force:true});}}
function fixture(){const w=new World({...defaults,population:1,resourceCount:0,startingMinePerTribe:false});const a=w.alive()[0];a.p=w.index(8,8);w.owners[a.p]=null;const log=[{kind:'INITIAL',config:clone(w.config),scenario:scenario(w)}];
  function turn(actions={}){w.prepare();const observations=Object.fromEntries(w.alive().map(a=>[a.id,w.observation(a)])),decisions=Object.fromEntries(w.alive().map(a=>[a.id,{action:actions[a.id]||{type:'WAIT'}}]));settle(w,decisions);log.push(clone({kind:'ROUND',turn:w.turn,observations,decisions,statistics:w.statistics(),events:w.events,validForEvaluation:true,serviceFaults:0}));}
  turn({[a.id]:{type:'MOVE',p:w.index(9,9)}});log.push(applyConfig(w,{territoryTax:.2}));log.push(editMap(w,[{p:w.index(12,12),tool:'territory',tribe:'A'}]));turn({[a.id]:{type:'CLAIM',p:a.p}});return {w,log};
}
test('historical replay reproduces custom spawns, moves, map edits and config changes without private data',async()=>temporary(async dir=>{
  const {w,log}=fixture(),file=path.join(dir,'sample.jsonl');await writeFile(file,log.map(r=>JSON.stringify(r)).join('\n')+'\n');const replay=await buildReplay(file,{episode:'sample'});
  assert.equal(replay.verifiedTurns,2);assert.equal(replay.frames[0].agents[0].position.join(','),'8,8');assert.equal(replay.frames[2].totalEnergy,w.statistics().totalEnergy);assert.deepEqual(replay.frames[2].tribes,w.statistics().tribes);assert.equal(replay.frames[1].movements[0].path.length,3);assert.equal(replay.frames[2].major.filter(e=>e.kind==='edit').length,2);
  const text=JSON.stringify(replay);for(const name of ['observations','rawSources','own_receipts','LANGUAGE_API_KEY','endpoint'])assert.equal(text.includes(`"${name}"`),false);
}));
test('a trailing live partial line is ignored, interior corruption and divergent settlement fail visibly',async()=>temporary(async dir=>{
  const {log}=fixture(),file=path.join(dir,'sample.jsonl'),text=log.map(r=>JSON.stringify(r)).join('\n');await writeFile(file,text+'\n{"kind":"ROUND",');const replay=await buildReplay(file,{episode:'sample'});assert.equal(replay.verifiedTurns,2);assert.equal(replay.warnings.length,1);
  await writeFile(file,text.replace('\n','\nnot-json\n'));await assert.rejects(buildReplay(file,{episode:'sample'}));log.at(-1).statistics.totalEnergy+=1;await writeFile(file,log.map(r=>JSON.stringify(r)).join('\n'));await assert.rejects(buildReplay(file,{episode:'sample'}),/校验不一致/);
}));
test('initial-only logs are valid and source fault markers remain part of replay',async()=>temporary(async dir=>{
  const {log}=fixture(),file=path.join(dir,'sample.jsonl');await writeFile(file,JSON.stringify(log[0]));assert.equal((await buildReplay(file,{episode:'sample'})).verifiedTurns,0);log.at(-1).serviceFaults=1;log.at(-1).validForEvaluation=false;await writeFile(file,log.map(r=>JSON.stringify(r)).join('\n'));const r=await buildReplay(file,{episode:'sample'});assert.equal(r.frames.at(-1).valid,false);assert.ok(r.majorEvents.some(e=>e.kind==='fault'));
}));
test('replay store rejects path traversal and completes its background worker with a reusable cache',async()=>temporary(async dir=>{
  const store=new ReplayStore(dir);for(const id of ['../x','C:\\x','x/y',''])assert.throws(()=>store.file(id));const {log}=fixture();await writeFile(path.join(dir,'sample.jsonl'),log.map(r=>JSON.stringify(r)).join('\n'));assert.equal((await store.list('sample'))[0].current,true);assert.equal((await store.start('sample')).state,'building');for(let i=0;i<100&&store.status('sample').state==='building';i++)await new Promise(r=>setTimeout(r,25));assert.equal(store.status('sample').state,'ready');assert.equal(JSON.parse(await store.data('sample')).verifiedTurns,2);assert.equal((await store.start('sample')).state,'ready');
}));
test('major events identify extinction and the first cross-tribe battle only once',()=>{
  const prior={agents:[{tribe:'A',position:[2,3]}],tribes:[{tribe:'A',population:1,publicEnergy:20,controlledResources:1}]},next={turn:8,agents:[],tribes:[{tribe:'A',population:0,publicEnergy:20,controlledResources:1}]},seen=new Set(),battle={type:'ATTACK',result:'OK',actor:'B001',target:'A000',to:[2,3]};const events=majorEvents(prior,next,[battle],seen);assert.ok(events.some(e=>e.kind==='extinction'&&e.position[0]===2));assert.equal(events.filter(e=>e.kind==='battle').length,1);assert.equal(majorEvents(next,next,[battle],seen).filter(e=>e.kind==='battle').length,0);
});
test('clip edits preserve order, reject invalid spans and merge overlapping highlights',()=>{
  const clips=normalizeClips([{start:7,end:9},{start:1,end:2},{start:6,end:3},{start:'x',end:8}],10);assert.deepEqual(clips,[{start:7,end:9},{start:1,end:2}]);const tl=timeline(clips,.5);assert.equal(tl.duration,2.5);assert.equal(locate(tl,1.5).turn,1);assert.equal(locate(tl,99).progress,1);
  const h=highlights([{turn:10,score:10,kind:'extinction'},{turn:11,score:8,kind:'capture'}],20);assert.deepEqual(h,[{start:0,end:3},{start:8,end:12},{start:18,end:20}]);
});

test('detailed events distinguish mine capture without rewards, real gifts, policy changes and welfare shortages',()=>{
  const old={turn:1,owners:[[13,'B']],resources:{13:{production:1000}},agents:[{id:'A1',tribe:'A',position:[1,1]}],tribes:[{tribe:'A',population:5,publicEnergy:20,controlledResources:1,territory:10,nationalPolicy:'NEUTRAL',lastSubsistenceDemand:5,lastSubsistencePaid:5}]};
  const next={...clone(old),turn:2,owners:[[13,'A']],agents:[{id:'A1',tribe:'A',position:[1,1],energy:12},{id:'A2',tribe:'A',position:[1,2],energy:9}],tribes:[{...old.tribes[0],publicEnergy:0,controlledResources:2,nationalPolicy:'AGGRESSIVE',lastSubsistencePaid:3}]};
  const logged=[{type:'CLAIM',result:'OK',actor:'A1',position:[1,1]},{type:'TRANSFER',result:'OK',actor:'A1',target:'A2',amount:4},{type:'TRANSFER',result:'OK',actor:'A1',amount:10},{type:'NATIONAL_POLICY',tribe:'A',actor:'A1',stance:'AGGRESSIVE'}];
  const marked=majorEvents(old,next,logged,new Set(),{width:12});assert.equal(marked.filter(e=>e.kind==='capture').length,1);assert.match(marked.find(e=>e.kind==='capture').detail,/阿美瑞卡/);assert.match(marked.find(e=>e.kind==='capture').details.join(' '),/未记录矿点奖励/);assert.equal(marked.filter(e=>e.kind==='cooperation').length,1);assert.ok(marked.some(e=>e.kind==='policy'));assert.ok(marked.some(e=>e.title.includes('生活费不足')));
  assert.ok(!majorEvents(next,{...next,turn:3},[],new Set(),{width:12}).some(e=>e.kind==='policy'||e.title.includes('生活费不足')));
  assert.equal(roundSummary(old,next,{events:logged}).gifts,1);
});

test('detailed combat and casualty records retain actors, coordinates and causes without inventing a sole killer',()=>{
  const previous={agents:[{id:'B2',tribe:'B',position:[2,2]}],tribes:[{tribe:'B',population:1,publicEnergy:30,controlledResources:1}]},current={turn:9,agents:[],tribes:[{...previous.tribes[0],population:0}]};
  const logs=[{type:'ATTACK',result:'OK',actor:'A1',target:'B2',from:[1,2],to:[2,2],damage:10},{type:'ATTACK',result:'OK',actor:'A3',target:'B2',from:[2,1],to:[2,2],damage:10},{type:'DEATH',actor:'B2',cause:'ATTACK'}];
  const events=majorEvents(previous,current,logs);const combat=events.find(e=>e.kind==='combat');assert.match(combat.detail,/2 次命中/);assert.match(combat.details.join(' '),/A3/);assert.equal(events.find(e=>e.kind==='extinction').score,10);assert.match(events.find(e=>e.kind==='extinction').details.join(' '),/遭到攻击/);
});

test('downloadable report includes every completed round and initial/final provenance',async()=>temporary(async dir=>{
  const {log}=fixture(),file=path.join(dir,'report.jsonl');await writeFile(file,log.map(r=>JSON.stringify(r)).join('\n'));const r=await buildReplay(file,{episode:'report'}),markdown=replayReport(r);assert.equal(r.version,2);assert.match(markdown,/T0～T2/);assert.equal((markdown.match(/^### T\d+/gm)||[]).length,2);assert.match(markdown,/### T001/);assert.match(markdown,/### T002/);assert.match(markdown,/生活费 实发 \/ 应发/);assert.ok(r.frames[1].summary);
}));
test('streaming WebM gains finite duration without changing media blocks; repeated finalization is stable',async()=>{
  const bytes=new Uint8Array([0x1a,0x45,0xdf,0xa3,0x80,0x18,0x53,0x80,0x67,0x01,255,255,255,255,255,255,255,
    0x15,0x49,0xa9,0x66,0x87,0x2a,0xd7,0xb1,0x83,0x0f,0x42,0x40,
    0x1f,0x43,0xb6,0x75,0xff,0xe7,0x81,0,0xa3,0x85,0x81,0,250,0x80,1]);
  const first=await finalizeWebM(new Blob([bytes],{type:'video/webm'}),1000);assert.ok(Math.abs(first.duration-.2833333333)<.000001);assert.equal(first.blob.size,bytes.length+11);
  const output=new Uint8Array(await first.blob.arrayBuffer());assert.deepEqual(output.slice(-7),bytes.slice(-7));const second=await finalizeWebM(first.blob,1000);assert.equal(second.blob.size,first.blob.size);assert.equal(second.duration,first.duration);
  await assert.rejects(finalizeWebM(new Blob(['not a movie']),1000));
});
