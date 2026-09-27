import {createReadStream} from 'node:fs';
import {stat,writeFile,rename} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {World} from './world.mjs';
import {settle,applyUpgrade} from './settle.mjs';
import {applyNationalPolicy} from './national-policy.mjs';
import {applyConfig,editMap,importScenario} from './editor.mjs';
import {clone} from './util.mjs';

export const replayVersion=1;
const names={A:'混沌战帮',B:'阿美瑞卡',C:'神圣泰拉',D:'蜂巢意志'};
export function majorEvents(previous,current,events,seen=new Set()){
  const out=[],turn=current.turn;
  const add=(kind,title,detail,tribe,position,score)=>out.push({id:`${turn}:${kind}:${out.length}`,turn,kind,title,detail,tribe,position,score});
  for(const e of events){
    const tribe=e.actor?.[0]||e.tribe,name=names[tribe]||tribe;
    if(e.type==='CAPTURE_REWARD')add('capture',`${name}夺取敌矿`,`${e.actor} · 奖励 ${e.amount} E`,tribe,e.position,8);
    if(e.type==='DISCOVERY_REWARD')add('mine',`${name}占领无主矿`,`${e.actor} · 新增长期收入`,tribe,e.position,5);
    if(e.type==='SUCCESSION')add('succession',`${name}国王更替`,`${e.previous} → ${e.actor}`,tribe,current.agents.find(a=>a.id===e.actor)?.position,7);
    if(e.type==='ATTACK'&&e.result==='OK'&&typeof e.target==='string'&&e.actor?.[0]!==e.target[0]&&!seen.has('first-battle')){seen.add('first-battle');add('battle','首次跨族交战',`${name} → ${names[e.target[0]]}`,tribe,e.to,8);}
  }
  for(const t of current.tribes){
    const old=previous?.tribes.find(p=>p.tribe===t.tribe);if(!old)continue;
    if(old.population>0&&t.population===0)add('extinction',`${names[t.tribe]}灭绝`,t.publicEnergy>0?`公账仍有 ${t.publicEnergy.toFixed(2)} E`:'最后个体死亡',t.tribe,previous.agents.find(a=>a.tribe===t.tribe)?.position,10);
    for(const n of [10,25,50])if(old.population<n&&t.population>=n&&!seen.has(`${t.tribe}:pop:${n}`)){seen.add(`${t.tribe}:pop:${n}`);add('population',`${names[t.tribe]}达到 ${n} 人`,'种群规模里程碑',t.tribe,null,4);}
    if(old.publicEnergy>0&&t.publicEnergy===0&&t.population>0&&!seen.has(`${t.tribe}:bankrupt`)){seen.add(`${t.tribe}:bankrupt`);add('economy',`${names[t.tribe]}公账耗尽`,'关注生活费与行动补给',t.tribe,null,6);}
    if(old.controlledResources>0&&t.controlledResources===0&&t.population>0)add('economy',`${names[t.tribe]}失去全部矿点`,'矿产收入中断',t.tribe,null,9);
  }
  return out;
}
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
    const current=frame(w,r);current.major=majorEvents(frames.at(-1),current,r.events||[],seen);
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
