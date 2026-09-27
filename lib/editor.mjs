import { tribes, units as U, clone, hash, validateConfig, mergeConfig } from './util.mjs';
import {terrainTypes} from './terrain.mjs';

export function editMap(w,edits) {
  if(w.prepared)throw new Error('回合执行中不能编辑');
  if(!Array.isArray(edits)||!edits.length||edits.length>4096)throw new Error('每次编辑1～4096格');
  const owners=[...w.owners],resources=clone(w.resources),buildings=clone(w.buildings),occupied=new Set(w.alive().map(a=>a.p));
  for(const edit of edits){
    const {p,tool,tribe}=edit;
    if(!Number.isInteger(p)||p<0||p>=owners.length)throw new Error('编辑坐标越界');
    if(tribe!==null&&!tribes.includes(tribe))throw new Error('请选择有效种族');
    if(tool==='territory'){
      if(buildings[p]&&buildings[p].tribe!==tribe)throw new Error('先删除建筑再改变该格归属');owners[p]=tribe;
    }else if(tool==='resource'){
      if(buildings[p])throw new Error('建筑格不能放资源');resources[p]={stock:U(w.config.resourceStock),production:U(w.config.resourceProduction),capacity:U(w.config.resourceCapacity),...(w.config.miningMode==='automatic'?{discovered:resources[p]?.discovered??owners[p]!==null}:{})};
    }else if(['WALL','GATE','FORT'].includes(tool)){
      if(!tribe||owners[p]!==tribe)throw new Error('建筑只能放在所选种族领地');
      if(occupied.has(p)||resources[p])throw new Error('资源或个体占用格不能放建筑');
      buildings[p]={type:tool,tribe,energy:U(w.config.buildings[tool]),complete:true};
    }else if(tool==='erase'){delete resources[p];delete buildings[p];}
    else throw new Error('未知画笔');
  }
  const before=w.total();w.owners=owners;w.resources=resources;w.buildings=buildings;w.net=null;w.revision++;
  const intervention={type:'MAP_EDIT',turn:w.turn,revision:w.revision,edits:clone(edits),externalEnergyDelta:(w.total()-before)/100};w.interventions.push(intervention);return intervention;
}
export function applyConfig(w,patch){
  if(w.prepared)throw new Error('回合执行中不能调参');
  const startupOnly=['seed','width','height','population','rotation','initialEnergy','publicEnergy','resourceCount','resourceDensity','resourceStock','startingMinePerTribe','reproductionMode','miningMode','terrainMode','neutralMineLayout','nationalPolicyEnabled'];
  if(startupOnly.some(k=>k in patch&&patch[k]!==w.config[k]))throw new Error('地图/初始条件修改需要「按配置新建实验」');
  const next=validateConfig(mergeConfig(w.config,patch));
  const living=w.alive();
  if(living.length>next.maxPopulation||tribes.some(t=>living.filter(a=>a.tribe===t).length>next.maxPopulationPerTribe))throw new Error('新人口上限低于当前存活人口；请新建实验应用');
  if(w.alive().some(a=>Math.round(U(next.capacity)*(1+.1*(a.skills.S3||0)))<a.energy))throw new Error('新容量低于当前个人能量；请新建实验应用');
  if(Object.values(w.resources).some(r=>r.stock>U(next.resourceCapacity)))throw new Error('新资源容量低于现有库存；请新建实验应用');
  if(Object.values(w.buildings).some(b=>b.energy>U(next.buildings[b.type])))throw new Error('新建筑上限低于当前结构能量；请新建实验应用');
  const previousHash=hash(w.config);w.config=next;
  for(const r of Object.values(w.resources)){r.production=U(next.resourceProduction);r.capacity=U(next.resourceCapacity);}
  w.revision++;const record={type:'CONFIG_EDIT',turn:w.turn,revision:w.revision,patch,previousHash,configHash:hash(next),externalEnergyDelta:0};w.interventions.push(record);return record;
}
export function scenario(w){return {format:'kev-map-v1',config:clone(w.config),biomes:clone(w.biomes||Array(w.owners.length).fill('PLAIN')),owners:w.owners.flatMap((t,p)=>t?[[p,t]]:[]),resources:clone(w.resources),buildings:clone(w.buildings),spawnPositions:Object.fromEntries(w.alive().map(a=>[a.id,a.p])),editedAtTurn:w.turn};}
export function importScenario(w,data){
  if(data.format!=='kev-map-v1'||!Array.isArray(data.owners)||!data.resources||!data.buildings)throw new Error('无效地图文件');
  const validP=p=>Number.isInteger(p)&&p>=0&&p<w.owners.length;
  const validEnergy=n=>Number.isSafeInteger(n)&&n>=0&&n<=1e9;
  const owners=Array(w.owners.length).fill(null),resources={},buildings={},positions=new Set();
  const biomes=data.biomes||Array(w.owners.length).fill('PLAIN');
  if(!Array.isArray(biomes)||biomes.length!==w.owners.length||biomes.some(t=>!terrainTypes.includes(t)))throw new Error('无效外观地形');
  for(const [p,t] of data.owners){if(!validP(p)||!tribes.includes(t))throw new Error('无效领土');owners[p]=t;}
  for(const [p,r] of Object.entries(data.resources)){if(!validP(Number(p))||![r.stock,r.capacity,r.production].every(validEnergy)||r.stock>r.capacity||('discovered'in r&&typeof r.discovered!=='boolean'))throw new Error('无效资源');resources[p]={stock:r.stock,capacity:r.capacity,production:r.production,...(w.config.miningMode==='automatic'?{discovered:r.discovered??owners[p]!==null}:{})};}
  for(const a of w.alive()){
    const p=data.spawnPositions?.[a.id]??a.p;if(!validP(p)||positions.has(p))throw new Error('无效出生位置');a.p=p;positions.add(p);
  }
  for(const [p,b] of Object.entries(data.buildings)){if(!validP(Number(p))||!tribes.includes(b.tribe)||owners[p]!==b.tribe||!Object.hasOwn(w.config.buildings,b.type)||!validEnergy(b.energy)||b.energy===0||b.energy>U(w.config.buildings[b.type])||typeof b.complete!=='boolean'||resources[p]||(positions.has(Number(p))&&b.complete&&b.type==='WALL'))throw new Error('无效建筑');buildings[p]={type:b.type,tribe:b.tribe,energy:b.energy,complete:b.complete};}
  w.biomes=clone(biomes);w.owners=owners;w.resources=resources;w.buildings=buildings;w.initialTotal=w.total();w.history=[w.statistics()];w.interventions=[{type:'IMPORTED_SCENARIO',turn:0,sourceTurn:data.editedAtTurn||0,externalEnergyDelta:0}];return w;
}
