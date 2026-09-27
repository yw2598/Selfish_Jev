import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {World} from '../lib/world.mjs';
import {Simulation} from '../lib/policy.mjs';
import {mergeConfig,clone,validateConfig} from '../lib/util.mjs';
import {teamIds,teamService} from '../lib/service-config.mjs';
import {ServiceSecrets} from '../lib/service-secrets.mjs';
import {LanguageService} from '../lib/context.mjs';
const defaults=JSON.parse(readFileSync(new URL('../defaults.json',import.meta.url),'utf8'));
async function mock(handler){const server=http.createServer(async(req,res)=>{try{let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):null;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await handler(req,body)));}catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}));}});await new Promise(r=>server.listen(0,'127.0.0.1',r));return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(r=>{server.close(r);server.closeAllConnections();})};}
function decision(body){const entries=Object.entries(body.questions.decision.criteria),phase=body.state.observation.phase;const chosen=entries.find(([,s])=>s.startsWith(phase==='NATIONAL_POLICY'?'保守':phase==='SKILL_UPGRADE'?'暂不':'等待'))?.[0]||entries[0][0];return {answers:{decision:{probabilities:Object.fromEntries(entries.map(([k])=>[k,k===chosen?1:0]))}},usage:{input_tokens:7}};}

test('four independent Jev endpoints receive only their own units, rulers and upgrades',async()=>{
  const received=Object.fromEntries(teamIds.map(t=>[t,[]])),servers={},folder=await mkdtemp(path.join(os.tmpdir(),'jev-services-'));
  try{
    for(const team of teamIds)servers[team]=await mock((req,body)=>{assert.equal(req.headers.authorization,`Bearer unit-test-${team}`);if(req.url==='/v1/models')return {models:[{name:`model-${team}`,run:`revision-${team}`}]};received[team].push(body);assert.equal(body.model,`model-${team}`);assert.match(body.state.observation.self.id,new RegExp('^'+team));return decision(body);});
    const config=mergeConfig(defaults,{decisionMode:'kev',population:1,upgradeEvery:1,language:{endpoint:''},kev:{teams:Object.fromEntries(teamIds.map(t=>[t,{endpoint:servers[t].url,model:`model-${t}`}]))}}),secrets=new ServiceSecrets(path.join(folder,'keys.local.json'));
    await secrets.save(secrets.prepare(Object.fromEntries(teamIds.map(t=>[t,`unit-test-${t}`])),config));
    const world=new World(config),sim=new Simulation(world,{secrets});const record=await sim.step();
    assert.equal(record.serviceFaults,0);assert.equal(record.conservation.error,0);assert.equal(new Set(Object.values(sim.clients)).size,4);
    for(const t of teamIds){const phases=new Set(received[t].map(b=>b.state.observation.phase));assert.ok(phases.has('WORLD_ACTION'));assert.ok(phases.has('NATIONAL_POLICY'));assert.ok(phases.has('SKILL_UPGRADE'));assert.equal(record.models[t].endpoint,servers[t].url);assert.equal(sim.services()[t].connection.status,'connected');}
    assert.equal(record.requests,Object.values(received).flat().length);assert.equal(record.inputTokens,record.requests*7);assert.ok(!JSON.stringify(record).includes('unit-test-'));
    // Version comparisons remain per team after restoring a checkpoint.
    const restored=new Simulation(world,{secrets});await restored.health();restored.clients.B.health=async()=>restored.clients.B.modelInfo={run:'changed'};await assert.rejects(()=>restored.step(),/B 队远端模型版本已变化/);assert.equal(world.turn,1);
  }finally{await Promise.all(Object.values(servers).map(s=>s.close()));await rm(folder,{recursive:true,force:true});}
});

test('default teams share one Jev client and an endpoint queue',()=>{
  const w=new World(defaults),sim=new Simulation(w);assert.ok(teamIds.every(t=>sim.clients[t]===sim.client));assert.equal(sim.concurrency().limit,8);assert.equal(teamService(w.config,'D').endpoint,defaults.kev.endpoint);
});

test('endpoint-bound credentials persist separately, never follow endpoint changes, and can be cleared',async()=>{
  const folder=await mkdtemp(path.join(os.tmpdir(),'jev-keys-')),file=path.join(folder,'keys.local.json');
  try{const config=clone(defaults);config.language.endpoint='http://127.0.0.1:9876/v1';const store=new ServiceSecrets(file);await store.save(store.prepare({language:'test-private-key',A:'team-test'},config));
    const loaded=new ServiceSecrets(file);assert.deepEqual(loaded.headers('language',config.language.endpoint),{Authorization:'Bearer test-private-key'});assert.deepEqual(loaded.headers('language','http://127.0.0.1:9876/other'),{});assert.equal(loaded.flags(config).language,true);
    assert.ok(!JSON.stringify(config).includes('test-private-key'));assert.throws(()=>store.prepare({language:'bad\nkey'},config));assert.throws(()=>store.prepare({X:'test'},config));
    await loaded.save(loaded.prepare({language:''},config));assert.deepEqual(loaded.headers('language',config.language.endpoint),{});assert.equal(loaded.flags(config).language,false);assert.ok((await readFile(file,'utf8')).includes('team-test'));
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('custom LLM endpoint receives its own model and key using chat completions',async()=>{
  let requests=0;const server=await mock((req,body)=>{assert.equal(req.url,'/v1/chat/completions');assert.equal(req.headers.authorization,'Bearer custom-llm-test');assert.equal(body.model,'custom-language');requests++;return {choices:[{message:{content:'{"ok":true}'}}]};});
  try{const client=new LanguageService({endpoint:server.url+'/v1',model:'custom-language',timeoutMs:1000,concurrency:2},{headers:()=>({Authorization:'Bearer custom-llm-test'})});const result=await client.json('test',{task:'test'},v=>assert.equal(v.ok,true));assert.deepEqual(result,{ok:true});assert.equal(requests,1);}finally{await server.close();}
});

test('service validation rejects credential-bearing URLs, secret fields, invalid teams and malformed endpoints',()=>{
  for(const endpoint of ['file:///etc/passwd','https://user:pass@example.com','https://example.com?api_key=test','https://example.com#secret','not-a-url'])assert.throws(()=>validateConfig(mergeConfig(defaults,{kev:{teams:{A:{endpoint}}}})));
  for(const field of ['apiKey','key','authorization']){const c=clone(defaults);c.kev.teams.A[field]='secret';assert.throws(()=>validateConfig(c),/端点和模型/);}
  const c=clone(defaults);c.kev.teams.X={endpoint:'',model:''};assert.throws(()=>validateConfig(c),/仅支持/);
  const normalized=validateConfig(mergeConfig(defaults,{kev:{teams:{A:{endpoint:'http://localhost:1234/'}}}}));assert.equal(normalized.kev.teams.A.endpoint,'http://localhost:1234');
});
