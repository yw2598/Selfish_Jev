import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { LanguageService,Compressor } from '../lib/context.mjs';
import { KevClient,Simulation } from '../lib/policy.mjs';
import { World } from '../lib/world.mjs';
import { mergeConfig,clone } from '../lib/util.mjs';
const defaults=JSON.parse(readFileSync(new URL('../defaults.json',import.meta.url),'utf8'));
// Isolate these pre-existing mechanics; subsistence/policy integration has its own suite.
defaults.subsistencePayment=0;defaults.nationalPolicyEnabled=false;defaults.decisionMode='kev';
async function mock(handler){const server=http.createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;const body=text?JSON.parse(text):null;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(handler(body,req)));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))};}
test('Kev retries malformed probability distributions once and never invents an action',async()=>{
  let calls=0;const server=await mock(()=>{calls++;return {answers:{decision:{probabilities:{C00:.4,ATTACK:.6}}}};});
  try{const client=new KevClient({endpoint:server.url,timeoutMs:1000,model:'kev-latest'});await assert.rejects(()=>client.choose({questions:{decision:{criteria:{C00:'等待',C01:'采集'}}}}),/概率缺失或越界/);assert.equal(calls,2);assert.equal(client.stats.failures,1);}finally{await server.close();}
});
test('message protocol rejects forged metadata and exposes only selected claims to language model',async()=>{
  const requests=[];const server=await mock(body=>{requests.push(body);return {choices:[{message:{content:JSON.stringify({body:'给我钱',sender_id:'RULER'})}}]};});
  try{const language=new LanguageService({endpoint:server.url,model:'fake-test-only',timeoutMs:1000}),result=await language.message({intent:'ENERGY_REQUEST',claims:{balance_band:'LOW',request_energy:20},style:'URGENT',privateEnergy:80});assert.equal(result.fallback,true);assert.equal(requests.length,2);for(const request of requests){const task=JSON.parse(request.messages[1].content);assert.ok(!('privateEnergy'in task));assert.deepEqual(task.claims,{balance_band:'LOW',request_energy:20});assert.equal(request.messages.length,2);}}finally{await server.close();}
});
test('language credentials are sent only to their configured origin',async()=>{
  const savedKey=process.env.LANGUAGE_API_KEY,savedOrigin=process.env.LANGUAGE_API_KEY_ORIGIN,headers=[];
  const server=await mock((body,req)=>{headers.push(req.headers.authorization);return {choices:[{message:{content:JSON.stringify({body:'请求20 E。'})}}]};});
  try{
    process.env.LANGUAGE_API_KEY='test-key-not-a-secret';process.env.LANGUAGE_API_KEY_ORIGIN='https://openrouter.ai';
    const service=new LanguageService({endpoint:server.url,model:'test-only',timeoutMs:1000}),action={intent:'ENERGY_REQUEST',claims:{request_energy:20},style:'NEUTRAL'};
    assert.equal((await service.message(action)).fallback,false);assert.equal(headers[0],undefined);
    process.env.LANGUAGE_API_KEY_ORIGIN=server.url;
    assert.equal((await service.message(action)).fallback,false);assert.equal(headers[1],'Bearer test-key-not-a-secret');
  }finally{
    if(savedKey===undefined)delete process.env.LANGUAGE_API_KEY;else process.env.LANGUAGE_API_KEY=savedKey;
    if(savedOrigin===undefined)delete process.env.LANGUAGE_API_KEY_ORIGIN;else process.env.LANGUAGE_API_KEY_ORIGIN=savedOrigin;
    await server.close();
  }
});
test('compression rejects forged sources and merging contradictory claims',async()=>{
  let count=0;const server=await mock(body=>{count++;const task=JSON.parse(body.messages[1].content);return {choices:[{message:{content:JSON.stringify({items:[{source_ids:task.sources.map(s=>s.id),summary_text:'所有人都没有能量'}]})}}]};});
  try{const config=clone(defaults.compression);config.memory.count=1;const language=new LanguageService({endpoint:server.url,model:'fake-test-only',timeoutMs:1000}),compressor=new Compressor(config,language),sources=Array.from({length:6},(_,i)=>({id:String(i),owner_id:'A',channel:'memory',event_turn:0,available_turn:0,expires_turn:20,provenance:'group_report',topic_key:'balance',value:i,text:`余额${i}`}));const result=await compressor.prepare('A','member','memory',sources,5);assert.equal(count,2);assert.equal(result.summaries.length,2);assert.ok(result.summaries.every(s=>s.excerpt_fallback&&s.unverified&&s.conflict_or_change));}finally{await server.close();}
});
test('source summaries reuse only unchanged authorized content, scoped to owner and role',async()=>{
  const requests=[],language={async json(system,task,validate){requests.push(task.sources.map(s=>s.id));const result={items:task.sources.map(s=>({source_ids:[s.id],summary_text:s.text}))};validate(result);return result;}};
  const config=clone(defaults.compression);config.memory.count=1;
  const compressor=new Compressor(config,language),sources=Array.from({length:7},(_,i)=>({id:String(i),owner_id:'A',event_turn:i,available_turn:i,expires_turn:20,provenance:'own_receipt',topic_key:String(i),value:i,text:`source ${i}`}));
  await compressor.prepare('A','member','memory',sources.slice(0,6),6);assert.deepEqual(requests,[['0','1']]);
  await compressor.prepare('A','member','memory',sources,7);assert.deepEqual(requests.at(-1),['2']);
  sources[0].text='corrected';sources[0].value=99;
  await compressor.prepare('A','member','memory',sources,8);assert.deepEqual(requests.at(-1),['0']);
  await compressor.prepare('A','ruler','memory',sources,8);assert.deepEqual(requests.at(-1),['0','1','2']);
  assert.equal((await compressor.prepare('B','member','memory',sources,8)).active_source_count,0);
  assert.equal((await compressor.prepare('A','member','memory',sources,20)).active_source_count,0);
});
test('unexpected settlement failure restores the entire last completed world',async()=>{
  const w=new World(mergeConfig(defaults,{population:1,resourceCount:0,startingMinePerTribe:false,language:{endpoint:''}})),sim=new Simulation(w),before=w.exportState();
  sim.client.health=async()=>{sim.client.modelInfo={run:'test-only'};return sim.client.modelInfo;};
  sim.client.choose=async payload=>({probabilities:Object.fromEntries(Object.entries(payload.questions.decision.criteria).map(([id,text])=>[id,text.includes('等待')?1:0])),raw:{usage:{input_tokens:0}},latencyMs:0});
  const original=w.pay;w.pay=()=>{throw new Error('synthetic settlement error');};
  // Methods are not world data; test injection uses prototype so snapshot serialization stays valid.
  delete w.pay;World.prototype.pay=()=>{throw new Error('synthetic settlement error');};
  try{await assert.rejects(()=>sim.step(),/synthetic settlement error/);assert.deepEqual(w.exportState(),before);assert.equal(w.prepared,false);}finally{World.prototype.pay=original;}
});
test('source identifiers do not change when other agents are processed in a different order',()=>{
  const wa=new World(mergeConfig(defaults,{population:1,resourceCount:0,startingMinePerTribe:false})),wb=new World(mergeConfig(defaults,{population:1,resourceCount:0,startingMinePerTribe:false}));wa.prepare();wb.prepare();for(const a of wa.alive())wa.observation(a);for(const a of wb.alive().reverse())wb.observation(a);assert.deepEqual(wa.agents,wb.agents);
});
test('restored model metadata is not a live connection and a lost service goes offline',async()=>{
  const server=await mock(()=>({models:[{name:'kev-latest',run:'same-model'}]}));
  const client=new KevClient({endpoint:server.url,model:'kev-latest'});client.modelInfo={run:'restored-old-info'};
  assert.equal(client.connection.status,'unchecked');await client.health();assert.equal(client.connection.status,'connected');
  await server.close();await assert.rejects(()=>client.health(),/连接失败/);assert.equal(client.connection.status,'offline');assert.equal(client.modelInfo.run,'same-model');assert.ok(client.connection.error.includes(server.url));
});
test('health check rejects a server that does not provide the configured model',async()=>{
  const server=await mock(()=>({models:[{name:'different-model',run:'unrelated'}]}));
  try{const client=new KevClient({endpoint:server.url,model:'kev-latest'});await assert.rejects(()=>client.health(),/没有提供模型/);assert.equal(client.connection.status,'offline');}finally{await server.close();}
});
test('background health checks cannot hide a model change from a restored experiment',async()=>{
  const w=new World(mergeConfig(defaults,{population:1,resourceCount:0,startingMinePerTribe:false}));w.runtime={model:{run:'original'},service:{},language:{}};
  const sim=new Simulation(w);sim.client.modelInfo={run:'changed'};sim.client.health=async()=>sim.client.modelInfo;
  await assert.rejects(()=>sim.step(),/模型版本已变化/);assert.equal(w.turn,0);
});

test('a dropped model socket is repaired before retrying the same frozen decision',async()=>{
  const requests=[];let repaired=false,recoveries=0;
  const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requests.push(body);
    if(!repaired){req.socket.destroy();return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({answers:{decision:{probabilities:{C00:.3,C01:.7}}}}));
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const tunnel={ensure:async()=>{},recover:async()=>{recoveries++;repaired=true;}};
  try{const client=new KevClient({endpoint:`http://127.0.0.1:${server.address().port}`,model:'kev-latest',timeoutMs:1000},{tunnel});
    const result=await client.choose({questions:{decision:{criteria:{C00:'WAIT',C01:'MOVE'}}}});
    assert.deepEqual(result.probabilities,{C00:.3,C01:.7});assert.equal(recoveries,1);assert.equal(requests.length,2);assert.equal(requests[0],requests[1]);assert.equal(client.stats.retries,1);assert.equal(client.stats.failures,0);assert.equal(client.connection.status,'connected');
  }finally{await new Promise(resolve=>server.close(resolve));}
});
