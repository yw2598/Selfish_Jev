import {createReadStream} from 'node:fs';
import {stat,writeFile,rename} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {World} from './world.mjs';
import {settle,applyUpgrade} from './settle.mjs';
import {applyNationalPolicy} from './national-policy.mjs';
import {applyConfig,editMap,importScenario} from './editor.mjs';
import {clone} from './util.mjs';
import {majorEvents as detailedEvents,roundSummary} from './replay-events.mjs';

export const replayVersion=2;
export const majorEvents=detailedEvents;
function frame(w,record=null){
  const stats=record?.statistics||w.statistics(),agents=w.alive().map(a=>({id:a.id,tribe:a.tribe,position:w.xy(a.p),energy:a.energy/100,ruler:w.rulers[a.tribe]===a.id}));
  const events=clone(record?.events||[]),moves=w.events.filter(e=>e.type==='MOVE'&&e.result==='OK');
  return {turn:w.turn,rulesVersion:w.config.rulesVersion||'legacy',agents,owners:w.owners.flatMap((t,p)=>t?[[p,t]]:[]),resources:clone(w.resources),buildings:clone(w.buildings),tribes:clone(stats.tribes),totalEnergy:stats.totalEnergy,
    movements:moves.map(e=>({actor:e.actor,path:e.path,from:e.from,position:e.position})),combat:events.filter(e=>e.type==='ATTACK'&&e.result==='OK'&&e.from&&e.to).map(e=>({...e,killed:events.some(d=>d.type==='DEATH'&&d.actor===e.target&&d.cause==='ATTACK')})),births:events.filter(e=>e.type==='BIRTH').map(e=>e.actor),deaths:events.filter(e=>e.type==='DEATH'),valid:record?.validForEvaluation!==false,major:[]};
}
export async function buildReplay(file,{episode,output,onProgress=()=>{},endTurn=Infinity}={}){
  const source=await stat(file),frames=[],seen=new Set(),warnings=[];let w,initial,records=0,pendingEdits=[];
  async function consume(line){
    if(!line.trim())return;const r=JSON.parse(line);records++;
    if(r.kind==='INITIAL'){
      if(w)throw Error('日志中出现重复初始状态');initial=r;w=new World(clone(r.config));if(r.scenario)importScenario(w,r.scenario);frames.push(frame(w));return;
    }
    if(r.type==='CONFIG_EDIT'&&w){applyConfig(w,r.patch);pendingEdits.push({kind:'edit',title:'规则参数调整',detail:Object.keys(r.patch).join('、'),score:6});return;}
    if(r.type==='MAP_EDIT'&&w){editMap(w,r.edits);pendingEdits.push({kind:'edit',title:'地图人工编辑',detail:`${r.edits.length} 个地块`,score:6});return;}
    if(r.kind!=='ROUND')return;
    if(!w)throw Error('缺少 INITIAL 初始状态，无法可靠还原');
    if(r.turn!==w.turn+1)throw Error(`回合不连续：期望 ${w.turn+1}，记录 ${r.turn}`);
    w.prepare();for(const a of w.alive())w.observation(a);
    for(const [tribe,d]of Object.entries(r.policyDecisions||{}))if(!d.fault)applyNationalPolicy(w,tribe,d);
    w.lastObservations=clone(r.observations);settle(w,clone(r.decisions));
    for(const [id,upgrades]of Object.entries(r.upgrades||{}))for(const d of upgrades)if(!d.fault)applyUpgrade(w,w.agents[id],d.action);
    if(w.total()/100!==r.statistics.totalEnergy||JSON.stringify(w.statistics().tribes)!==JSON.stringify(r.statistics.tribes))throw Error(`第 ${r.turn} 回合回放校验不一致，已停止生成`);
    const current=frame(w,r);current.major=majorEvents(frames.at(-1),current,r.events||[],seen,w.config);current.summary=roundSummary(frames.at(-1),current,r);
    for(const e of pendingEdits)current.major.push({...e,id:`${r.turn}:edit:${current.major.length}`,turn:r.turn});pendingEdits=[];
    if(r.serviceFaults)current.major.push({id:`${r.turn}:fault`,turn:r.turn,kind:'fault',title:'决策服务发生故障',detail:`${r.serviceFaults} 次故障，保留实际回退行动`,score:9});
    frames.push(current);w.history=[];onProgress({turn:w.turn,frames:frames.length});
  }
  // Freeze the byte range so a live simulation may continue appending safely.
  let pending='';for await(const line of createInterface({input:createReadStream(file,{end:source.size-1}),crlfDelay:Infinity})){
    if(pending)await consume(pending);if(w?.turn>=endTurn){pending='';break;}pending=line;
  }
  if(pending&&(!w||w.turn<endTurn)){try{JSON.parse(pending);}catch{warnings.push('日志末尾仍在写入，仅收录完整回合');pending='';}if(pending)await consume(pending);}
  if(!initial||!frames.length)throw Error('日志缺少可用初始状态');
  const c=initial.config,result={format:'selfish-gene-replay',version:replayVersion,episode,createdAt:new Date().toISOString(),source:{size:source.size,mtimeMs:source.mtimeMs},verifiedTurns:frames.length-1,
    config:{width:c.width,height:c.height,seed:c.seed,terrainMode:c.terrainMode,miningMode:c.miningMode,initialPopulation:c.population,decisionMode:c.decisionMode||'kev'},biomes:clone(w.biomes),warnings,frames,majorEvents:frames.flatMap(f=>f.major)};
  if(output){await writeFile(`${output}.tmp`,JSON.stringify(result));await rename(`${output}.tmp`,output);}return result;
}
