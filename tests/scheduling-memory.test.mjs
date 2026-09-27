import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RequestQueue,completeAll} from '../lib/request-queue.mjs';
import {SharedMemory,privateMemory} from '../lib/shared-memory.mjs';
import {Simulation} from '../lib/policy.mjs';
import {World} from '../lib/world.mjs';
const defaults=JSON.parse(readFileSync(new URL('../defaults.json',import.meta.url),'utf8'));
// Isolate these pre-existing mechanics; subsistence/policy integration has its own suite.
defaults.subsistencePayment=0;defaults.nationalPolicyEnabled=false;defaults.decisionMode='kev';

test('request queues reach configured concurrency, drain errors and preserve independent service slots',async()=>{
  const kev=new RequestQueue(8),language=new RequestQueue(2);let release;
  const blocked=new Promise(r=>release=r),pending=language.run(()=>blocked);
  let active=0,peak=0;
  await completeAll(Array.from({length:24},(_,i)=>kev.run(async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;return i;})));
  assert.equal(peak,8);assert.equal(language.status().active,1);release();await pending;
  await assert.rejects(()=>kev.run(()=>{throw Error('fail');}),/fail/);assert.equal(await kev.run(()=>42),42);
});
test('batch failure waits for siblings before allowing a world rollback',async()=>{
  let finished=false;await assert.rejects(()=>completeAll([Promise.reject(Error('first')),new Promise(resolve=>setTimeout(()=>{finished=true;resolve();},20))]),/first/);assert.equal(finished,true);
});
function inbox(owner,tribe,count=8){return Array.from({length:count},(_,i)=>({id:`${owner}:M${i}:${tribe}000:stock_band`,owner_id:owner,channel:'communication',event_turn:i,available_turn:i,expires_turn:20,provenance:'group_report',message_id:`M${i}:${tribe}000`,sender_id:`${tribe}000`,topic_key:`mine:${i}`,value:{stock_band:'LOW'},text:`mine ${i}`,unverified:true}));}
test('identical delivered tribal sources compress once and remap citations to each authorized recipient',async()=>{
  const calls=[],language={async json(system,task,validate){calls.push(task);await new Promise(r=>setTimeout(r,5));const result={items:task.sources.map(s=>({source_ids:[s.id],summary_text:s.text}))};validate(result);return result;}};
  const config=structuredClone(defaults.compression);config.communication.count=1;
  const shared=new SharedMemory(config,language),a={id:'A001',tribe:'A',inbox:inbox('A001','A')},b={id:'A002',tribe:'A',inbox:inbox('A002','A')};
  const [x,y]=await Promise.all([shared.prepare(a,8),shared.prepare(b,8)]);assert.equal(calls.length,1);assert.ok(calls.every(t=>t.channel==='communication'&&t.sources.every(s=>s.owner_id==='tribe:A'&&s.provenance==='group_report')));
  assert.ok(x.summaries.every(s=>s.unverified&&s.source_ids.every(id=>id.startsWith('A001:'))));assert.ok(y.summaries.every(s=>s.source_ids.every(id=>id.startsWith('A002:'))));
  const newborn=await shared.prepare({id:'A003',tribe:'A',inbox:inbox('A003','A').slice(-2)},8);assert.equal(newborn.active_source_count,2);assert.equal(newborn.summaries.length,0);assert.ok(newborn.recent_raw.every(s=>s.id.startsWith('A003:')));
  await shared.prepare({id:'B001',tribe:'B',inbox:inbox('B001','B')},8);assert.equal(calls.length,2);assert.ok(calls[1].sources.every(s=>s.owner_id==='tribe:B'));
  const expired=await shared.prepare(a,20);assert.equal(expired.active_source_count,0);assert.equal(expired.summaries.length,0);
});
test('private memory stays raw and no first-round private observation is sent for compression',async()=>{
  const w=new World(defaults),sim=new Simulation(w),calls=[];sim.client.health=async()=>sim.client.modelInfo={run:'test'};
  sim.client.choose=async payload=>{const criteria=payload.questions.decision.criteria,wait=Object.entries(criteria).find(([,v])=>v.includes('等待'))?.[0]||Object.keys(criteria)[0];return {probabilities:Object.fromEntries(Object.keys(criteria).map(k=>[k,k===wait?1:0])),raw:{},latencyMs:0};};
  sim.language.json=async(...args)=>{calls.push(args);return null;};await sim.step();
  assert.equal(calls.filter(([,task])=>task.task==='COMPRESS_CONTEXT').length,0);
  for(const o of Object.values(w.lastObservations)){assert.deepEqual(o.memory_context.summaries,[]);assert.equal(o.memory_context.compression,'none-private-raw');}
  const a=w.alive()[0],before=structuredClone(a.memory),view=privateMemory(a.id,a.memory,w.turn,defaults.compression);assert.deepEqual(a.memory,before);assert.ok(view.recent_raw.every(s=>before.some(p=>p.id===s.id)));assert.ok(view.omitted_source_count>=0);
});
