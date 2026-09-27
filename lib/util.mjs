import { createHash } from 'node:crypto';
import {validateServices} from './service-config.mjs';

export const tribes = ['A', 'B', 'C', 'D'];
export const units = n => Math.round(n * 100);
export const energy = n => n / 100;
export const clone = x => structuredClone(x);
export const canonical = x => JSON.stringify(x, (_, value) => value && !Array.isArray(value) && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]])) : value);
export const hash = x => createHash('sha256').update(canonical(x)).digest('hex');
export const key = (...parts) => parseInt(hash(parts).slice(0, 8), 16);
export function rng(seed) {
  let s = key(seed);
  return () => { s += 0x6D2B79F5; let t = Math.imul(s ^ s >>> 15, 1 | s); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function shuffled(items, seed) {
  const a = [...items], random = rng(seed);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export function fairShare(requests, available, seed) {
  const result = Object.fromEntries(requests.map(r => [r.id, 0]));
  let active = requests.filter(r => r.amount > 0).map(r => ({...r}));
  while (available > 0 && active.length) {
    const share = Math.floor(available / active.length);
    if (share === 0) {
      for (const r of [...active].sort((a, b) => key(seed, a.id) - key(seed, b.id) || a.id.localeCompare(b.id)).slice(0, available)) result[r.id]++;
      break;
    }
    for (const r of active) { const n = Math.min(r.amount, share); result[r.id] += n; r.amount -= n; available -= n; }
    active = active.filter(r => r.amount > 0);
  }
  return result;
}
export function mergeConfig(base, patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('配置必须为对象');
  const result = clone(base);
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in base) || ['__proto__', 'constructor', 'prototype'].includes(k)) throw new Error(`未知配置项: ${k}`);
    result[k] = v && typeof v === 'object' && !Array.isArray(v) ? mergeConfig(base[k], v) : v;
  }
  return result;
}
export function validateConfig(c) {
  c.decisionMode ??= 'kev';
  if(!['kev','hybrid'].includes(c.decisionMode))throw new Error('decisionMode 必须为 kev 或 hybrid');
  // Older saved experiments predate configurable population limits.
  c.maxPopulation ??= 100;
  c.maxPopulationPerTribe ??= 50;
  // Keep legacy checkpoints and replay initial conditions unchanged.
  c.startingMinePerTribe ??= false;
  c.reproductionMode ??= 'paired';
  c.miningMode ??= 'manual';c.discoveryReward ??= 50;
  c.terrainMode ??= 'plain';
  c.neutralMineLayout ??= 'legacy';c.explorationTendency ??= 'none';
  c.language.concurrency ??= 4;
  c.memoryCompression ??= 'legacy';
  c.subsistencePayment ??= 0;c.nationalPolicyEnabled ??= false;
  c.enemyMineReward ??= 0;c.killLootEnabled ??= false;c.claimFunding ??= 'personal';
  c.movementRange ??= 1;c.attackRange ??= 1;
  c.resourceDensity ??= 1;
  c.territoryTax ??= 0;c.claimReward ??= 0;c.contiguousExpansion ??= false;
  if(typeof c.contiguousExpansion!=='boolean')throw new Error('contiguousExpansion 必须为布尔值');
  if(typeof c.resourceDensity!=='number'||!Number.isFinite(c.resourceDensity)||c.resourceDensity<0||c.resourceDensity>1)throw new Error('resourceDensity 必须在0～1');
  if(typeof c.killLootEnabled!=='boolean')throw new Error('killLootEnabled 必须为布尔值');
  if(!['personal','public'].includes(c.claimFunding))throw new Error('未知占领费用来源');
  if(typeof c.nationalPolicyEnabled!=='boolean')throw new Error('nationalPolicyEnabled 必须为布尔值');
  if(!['tribe-shared','legacy'].includes(c.memoryCompression))throw new Error('未知记忆压缩范围');
  if(!['vision5','legacy'].includes(c.neutralMineLayout))throw new Error('未知中立矿分布模式');
  if(!['none','moderate','strong'].includes(c.explorationTendency))throw new Error('未知探索倾向');
  if(!['decorative','plain'].includes(c.terrainMode))throw new Error('未知地形模式');
  if(!['automatic','manual'].includes(c.miningMode))throw new Error('未知矿点模式');
  if(!['individual','paired'].includes(c.reproductionMode))throw new Error('未知繁殖模式');
  if(typeof c.startingMinePerTribe!=='boolean')throw new Error('startingMinePerTribe 必须为布尔值');
  if (![24, 32, 64, 128, 256].includes(c.width) || ![24, 32, 64, 128, 256].includes(c.height)) throw new Error('地图宽高必须为24、32、64、128或256');
  const integer = (name, value, min, max) => { if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} 必须为 ${min}～${max} 的整数`); };
  integer('seed', c.seed, 0, 2147483647); integer('population', c.population, 1, 36); integer('rotation', c.rotation, 0, 3);
  integer('maxPopulation', c.maxPopulation, 1, c.width*c.height);
  integer('maxPopulationPerTribe', c.maxPopulationPerTribe, 1, c.width*c.height);
  if (c.population*tribes.length>c.maxPopulation || c.population>c.maxPopulationPerTribe) throw new Error('初始人口不能超过总人口或单族人口上限');
  integer('maxTurns', c.maxTurns, 1, 100000); integer('upgradeEvery', c.upgradeEvery, 1, 10000);
  integer('movementRange',c.movementRange,1,3);integer('attackRange',c.attackRange,1,3);
  integer('skillSlots', c.skillSlots, 1, 3); integer('skillMaxLevel', c.skillMaxLevel, 1, 3);
  integer('rulerPadding', c.rulerPadding, 0, 8); integer('kev.concurrency', c.kev.concurrency, 1, 32);
  integer('language.concurrency',c.language.concurrency,1,32);
  integer('kev.timeoutMs', c.kev.timeoutMs, 1000, 300000); integer('language.timeoutMs', c.language.timeoutMs, 1000, 300000);
  for (const name of ['communicationTTL', 'memoryTTL']) integer(name, c[name], 1, 1000);
  const amount = (k,v) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e7 || Math.abs(v * 100 - Math.round(v * 100)) > 1e-5) throw new Error(`${k} 必须为非负能量，最多两位小数`); };
  for (const name of ['initialEnergy','capacity','publicEnergy','survivalCost','resourceProduction','resourceCapacity','resourceStock','harvestLimit','buildLimit','attackDamage']) amount(name,c[name]);
  amount('discoveryReward',c.discoveryReward);
  amount('enemyMineReward',c.enemyMineReward);
  amount('subsistencePayment',c.subsistencePayment);
  amount('territoryTax',c.territoryTax);amount('claimReward',c.claimReward);
  for (const [k,v] of Object.entries(c.costs)) amount(k,v);
  for (const [k,v] of Object.entries(c.buildings)) { amount(k,v); if (!v) throw new Error('建筑容量必须大于0'); }
  if (c.initialEnergy <= 0 || c.initialEnergy > c.capacity || c.resourceStock > c.resourceCapacity) throw new Error('初始库存/能量必须处于容量以内');
  for (const [k,v] of Object.entries(c.selfWeights)) if (typeof v !== 'number' || v < 0 || v > 1 || !Number.isFinite(v)) throw new Error(`${k} 权重须在0～1`);
  for (const name of ['fortDefense','maxDefense']) if (typeof c[name] !== 'number' || c[name] < 0 || c[name] > 1) throw new Error('减伤比例须在0～1');
  if (c.resourceCount !== null) integer('resourceCount', c.resourceCount, 0, c.width * c.height - 144);
  if(c.startingMinePerTribe&&c.resourceCount!==null&&c.resourceCount<tribes.length)throw new Error('每族初始矿点需要至少4个资源点');
  if (!Array.isArray(c.birthInvestments) || !c.birthInvestments.length) throw new Error('繁殖投入档位不能为空');
  c.birthInvestments.forEach(v => { amount('birthInvestments',v); if (!v || v * (c.reproductionMode==='individual'?1:2) > c.capacity) throw new Error('子代投入必须为正且总投入不能超过容量'); });
  for (const [k,v] of Object.entries(c.reward)) amount(k,v);
  for (const k of ['recent','period','maxRequestChars','maxItemChars']) integer(k,c.compression[k],1,100000);
  if (c.compression.maxRequestChars < 1000) throw new Error('压缩请求上限至少1000字符');
  for (const channel of ['communication','memory']) for (const [k,v] of Object.entries(c.compression[channel])) integer(`${channel}.${k}`,v,1,100000);
  validateServices(c);
  return c;
}
