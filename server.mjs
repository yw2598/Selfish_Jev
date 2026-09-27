import http from 'node:http';
import { readFile, writeFile, appendFile, mkdir, rename } from 'node:fs/promises';
import { existsSync,createReadStream } from 'node:fs';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World } from './lib/world.mjs';
import { Simulation, rulesFor, compactObservation } from './lib/policy.mjs';
import { mergeConfig, validateConfig, clone, hash } from './lib/util.mjs';
import { editMap, applyConfig, scenario, importScenario } from './lib/editor.mjs';
import {ReplayStore} from './lib/replay-store.mjs';
import {ServiceSecrets} from './lib/service-secrets.mjs';
import {teamIds,teamService} from './lib/service-config.mjs';
import {LanguageService} from './lib/context.mjs';

const root=path.dirname(fileURLToPath(import.meta.url)),artifacts=process.env.ARTIFACTS_DIR||path.join(root,'artifacts');
const defaults=validateConfig(JSON.parse(await readFile(path.join(root,'defaults.json'),'utf8')));
await mkdir(artifacts,{recursive:true});
const replayStore=new ReplayStore(artifacts);
const secrets=new ServiceSecrets(process.env.SERVICE_SECRETS_FILE||path.join(artifacts,'service-secrets.local.json'));
const demoFile=name=>existsSync(path.join(artifacts,name))?path.join(artifacts,name):path.join(root,'demo',name);
const makeSimulation=w=>new Simulation(w,{secrets});
let world=new World(defaults),simulation=makeSimulation(world),running=false,busy=false,lastError=null,remaining=0,episode=`session-${Date.now()}`,published=world.exportState();
let clientInfo=null;
if(existsSync(path.join(artifacts,'latest.checkpoint.json')))try{
  const checkpoint=JSON.parse(await readFile(path.join(artifacts,'latest.checkpoint.json'),'utf8'));
  validateConfig(checkpoint.world.config);world=Object.assign(Object.create(World.prototype),checkpoint.world);world.prepared=false;world.net=null;
  episode=checkpoint.episode;simulation=makeSimulation(world);published=world.exportState();if(world.runtime?.lastRound?.serviceFaults)lastError=`第${world.turn}回合 ${world.runtime.lastRound.serviceFaults} 个决策服务故障，已保留实际回退并暂停；请检查模型连接。`;console.log(`Resumed ${episode}, turn ${world.turn}`);
}catch(e){console.error(`Checkpoint could not be restored: ${e.message}`);}

async function audit(record){await appendFile(path.join(artifacts,`${episode}.jsonl`),JSON.stringify(record)+'\n','utf8');}
async function checkpoint(){
  const saved={...world};for(const k of ['net','snapshotAgents','snapshotBuildings','snapshotOwners','snapshotGrants','snapshotProjects','snapshotAccounts','occupied'])delete saved[k];
  await writeFile(path.join(artifacts,'latest.checkpoint.tmp'),JSON.stringify({episode,world:saved}),'utf8');
  await rename(path.join(artifacts,'latest.checkpoint.tmp'),path.join(artifacts,'latest.checkpoint.json'));
}
function status(){return {running,busy,remaining,episode,error:lastError,progress:simulation.progress,decisionMode:world.config.decisionMode,decisionRouting:world.runtime?.routing||{rule:0,kev:0,fallback:0},model:clientInfo||simulation.clients.A.modelInfo,modelStatus:simulation.connection().status,connection:simulation.connection(),services:simulation.services(),tunnel:simulation.client.tunnel?.status()||null,fineTunedForSandbox:false,languageMode:world.config.decisionMode==='hybrid'?'on-demand-llm':world.config.language.endpoint?'shared-llm':'deterministic-fallback',concurrency:{kev:simulation.concurrency(),language:simulation.language.queue.status()},stats:simulation.client.stats,languageStats:simulation.language.stats,lastRound:simulation.lastRound?{turn:simulation.lastRound.turn,routing:simulation.lastRound.routing,wallMs:simulation.lastRound.wallMs,requests:simulation.lastRound.requests,inputTokens:simulation.lastRound.inputTokens,serviceFaults:simulation.lastRound.serviceFaults}:null};}
function serviceSettings(){return {teams:Object.fromEntries(teamIds.map(t=>{const s=teamService(world.config,t);return[t,{endpoint:s.endpoint,model:s.model}];})),language:world.config.language,keys:secrets.flags(world.config),status:simulation.services(),running,busy};}
async function oneStep(){
  if(busy)throw new Error('当前回合仍在运行');busy=true;lastError=null;
  try{const record=await simulation.step();record.validForEvaluation=record.validForEvaluation&&!world.interventions.some(i=>i.turn>0);await audit({kind:'ROUND',...record});published=world.exportState();await checkpoint();if(record.serviceFaults){running=false;lastError=`本回合 ${record.serviceFaults} 个决策服务故障，已标无效并暂停；请检查模型连接。`;}}
  catch(e){lastError=e.message;running=false;throw e;}finally{busy=false;}
}
async function runLoop(){
  while(running&&remaining>0){try{await oneStep();}catch{break;}remaining--;if(world.turn>=world.config.maxTurns||!world.alive().length)break;await new Promise(r=>setTimeout(r,50));}
  running=false;
}
function requireIdle(){if(busy||running)throw new Error('请先暂停并等待当前回合结算');}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>8_000_000)throw new Error('请求过大');}return text?JSON.parse(text):{};}
function json(res,code,value){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
function preview(id){
  if(!world.agents[id])throw new Error('个体不存在');
  if(world.lastObservations[id])return {observation:world.lastObservations[id],decision:world.lastDecisions[id]||null,asOf:'last-decision'};
  const copy=Object.assign(Object.create(World.prototype),clone(world));copy.nextSource=0;copy.net=copy.networks();
  return {observation:copy.observation(copy.agents[id]),decision:null,asOf:'preview'};
}

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost'),route=url.pathname;
    if(req.method==='POST'){
      const origin=req.headers.origin;
      if(origin){const u=new URL(origin);if(!['127.0.0.1','localhost'].includes(u.hostname)||u.port!==String(server.address().port))return json(res,403,{error:'仅允许本地应用操作'});}
      if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'需要JSON'});
    }
    if(route==='/api/state'&&req.method==='GET')return json(res,200,{...published,status:status()});
    if(route==='/api/replays'&&req.method==='GET')return json(res,200,{episodes:await replayStore.list(episode)});
    if(route==='/api/replays/example'&&req.method==='GET'){
      const file=demoFile('demo-replay.json');if(!existsSync(file))return json(res,404,{error:'示例回放尚未生成，请选择历史记录载入'});
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-cache'});return res.end(await readFile(file));
    }
    if(route==='/api/replays/demo'&&req.method==='GET'){
      if(!existsSync(demoFile('selfish-gene-demo.webm')))return json(res,404,{error:'示例成片尚未生成'});
      const info=JSON.parse(await readFile(demoFile('replay-demo.json'),'utf8'));return json(res,200,{url:'/replay-demo.webm',description:info.description});
    }
    if(route==='/replay-demo.webm'&&['GET','HEAD'].includes(req.method)){
      const file=demoFile('selfish-gene-demo.webm');if(!existsSync(file))return json(res,404,{error:'示例成片尚未生成'});
      const {size}=await stat(file);let start=0,end=size-1,code=200;const range=req.headers.range;
      if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||(!m[1]&&!m[2])){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();}start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));end=m[1]&&m[2]?Math.min(size-1,Number(m[2])):size-1;if(start>end||start>=size||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();}code=206;}
      res.writeHead(code,{'Content-Type':'video/webm','Accept-Ranges':'bytes','Content-Length':end-start+1,'Cache-Control':'no-cache',...(code===206?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})});if(req.method==='HEAD')return res.end();const stream=createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());return stream.pipe(res);
    }
    if(route==='/api/replays/status'&&req.method==='GET')return json(res,200,replayStore.status(url.searchParams.get('id')));
    if(route==='/api/replays/data'&&req.method==='GET'){const data=await replayStore.data(url.searchParams.get('id'));res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(data);}
    if(route==='/api/status'&&req.method==='GET')return json(res,200,status());
    if(route==='/api/defaults'&&req.method==='GET')return json(res,200,defaults);
    if(route==='/api/services'&&req.method==='GET')return json(res,200,serviceSettings());
    if(route==='/api/health'&&req.method==='GET'){
      try{clientInfo=await simulation.health();if(lastError?.includes('连接失败')||lastError==='fetch failed')lastError=null;return json(res,200,{ok:true,model:clientInfo,connection:simulation.connection(),services:simulation.services()});}catch(e){clientInfo=null;return json(res,200,{ok:false,error:e.message,connection:simulation.connection(),services:simulation.services()});}
    }
    if(route==='/api/agent'&&req.method==='GET'){
      const id=url.searchParams.get('id'),item=preview(id);
      return json(res,200,{...item,nationalDecision:world.lastPolicyDecisions?.[world.agents[id].tribe]?.actor===id?world.lastPolicyDecisions[world.agents[id].tribe]:null,rules:rulesFor(world,world.agents[id],item.observation),promptObservation:compactObservation(item.observation)});
    }
    if(route==='/api/scenario'&&req.method==='GET')return json(res,200,scenario(world));
    if(route==='/api/report'&&req.method==='GET')return json(res,200,{episode,config:world.config,configHash:hash(world.config),fineTunedForSandbox:false,model:clientInfo||simulation.client.modelInfo,statistics:published.statistics,history:world.history,conservation:world.lastConservation,interventions:world.interventions,service:simulation.client.stats,language:simulation.language.stats});
    if(req.method==='POST'){
      const data=await body(req);
      if(route==='/api/replays/build')return json(res,202,await replayStore.start(data.id));
      if(route==='/api/services'){
        requireIdle();busy=true;try{
        if(!data.teams||!data.language)throw Error('请填写四队 Jev 与 LLM 设置');
        const patch={kev:{teams:data.teams},language:data.language},next=validateConfig(mergeConfig(world.config,patch));
        const secretValues=secrets.prepare(data.keys||{},next);
        // Validate the whole edit before persisting credentials or changing the live world.
        const draft=Object.assign(Object.create(World.prototype),clone(world));applyConfig(draft,patch);
        await secrets.save(secretValues);const record=applyConfig(world,patch);simulation=makeSimulation(world);clientInfo=null;lastError=null;
        await audit(record);published=world.exportState();await checkpoint();busy=false;return json(res,200,serviceSettings());
        }finally{busy=false;}
      }
      if(route==='/api/services/test-language'){
        const config=clone(world.config.language),client=new LanguageService(config,{headers:()=>secrets.headers('language',config.endpoint)});
        const result=await client.json('只输出 JSON {"ok":true}',{task:'CONNECTION_TEST'},v=>{if(v?.ok!==true)throw Error('LLM 测试返回格式不正确');});
        return json(res,200,{ok:result?.ok===true,message:result?.ok?'LLM 已连接，JSON 响应正常':'LLM 未通过测试，请检查端点、模型、密钥或额度'});
      }
      if(route==='/api/pause'){running=false;return json(res,200,{message:busy?'当前回合结算后暂停':'已暂停'});}
      if(route==='/api/run'){requireIdle();const turns=data.turns??1;if(!Number.isInteger(turns)||turns<1||turns>100000)throw new Error('回合数范围为1～100000');running=true;remaining=turns;void runLoop();return json(res,202,status());}
      if(route==='/api/step'){requireIdle();void oneStep().catch(()=>{});return json(res,202,status());}
      if(route==='/api/edit'){requireIdle();const record=editMap(world,data.edits);await audit(record);published=world.exportState();await checkpoint();return json(res,200,{ok:true,record});}
      if(route==='/api/config'){requireIdle();const record=applyConfig(world,data.patch);simulation=makeSimulation(world);clientInfo=null;lastError=null;await audit(record);published=world.exportState();await checkpoint();return json(res,200,{ok:true,record});}
      if(route==='/api/reset'||route==='/api/import'){
        requireIdle();const config=validateConfig(mergeConfig(defaults,route==='/api/import'?data.config:data.config||{}));
        const replacement=new World(config);if(route==='/api/import')importScenario(replacement,data);
        world=replacement;simulation=makeSimulation(world);clientInfo=null;episode=`session-${Date.now()}`;lastError=null;remaining=0;published=world.exportState();await audit({kind:'INITIAL',config,scenario:scenario(world),fineTunedForSandbox:false});await checkpoint();return json(res,200,{ok:true});
      }
    }
    const files={'/':'index.html','/app.js':'app.js','/service-settings.js':'service-settings.js','/pixel-art.js':'pixel-art.js','/combat-effects.js':'combat-effects.js','/movement-effects.js':'movement-effects.js','/factions.js':'factions.js','/favicon.svg':'favicon.svg','/styles.css':'styles.css','/replay-studio.js':'replay-studio.js','/replay-renderer.js':'replay-renderer.js','/replay-audio.js':'replay-audio.js','/replay-timeline.js':'replay-timeline.js','/webm-duration.js':'webm-duration.js'};
    if(req.method==='GET'&&files[route]){
      const file=files[route],type=file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.svg')?'image/svg+xml':'text/html';
      res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(await readFile(path.join(root,'public',file)));return;
    }
    json(res,404,{error:'未找到接口'});
  }catch(e){json(res,400,{error:e.message});}
});
server.listen(Number(process.env.PORT||8765),'127.0.0.1',()=>console.log(`Kev Sandbox: http://127.0.0.1:${server.address().port}`));
