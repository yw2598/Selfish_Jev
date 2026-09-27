import {writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {World} from '../lib/world.mjs';
import {settle,applyUpgrade} from '../lib/settle.mjs';
import {clone} from '../lib/util.mjs';
import {applyNationalPolicy} from '../lib/national-policy.mjs';

// Reconstruct a recorded rollout without invoking a model; compare each settled state.
const file=process.argv[2];if(!file)throw new Error('用法: node scripts/replay.mjs artifacts/baseline-128-100-kev4b.jsonl');
let world,rounds=0;
for await(const line of createInterface({input:createReadStream(file),crlfDelay:Infinity})){
  if(!line.trim())continue;
  const record=JSON.parse(line);
  if(record.kind==='INITIAL'){world=new World(record.config);continue;}
  if(record.kind!=='ROUND')continue;
  if(!world)throw new Error('Missing INITIAL record');
  if(!record.validForEvaluation&&!process.argv.includes('--allow-invalid')){console.log(`Stopped before invalid turn ${record.turn}; use --allow-invalid for debugging only.`);break;}
  world.prepare();for(const a of world.alive())world.observation(a);
  for(const [tribe,decision]of Object.entries(record.policyDecisions||{}))if(!decision.fault)applyNationalPolicy(world,tribe,decision);
  world.lastObservations=clone(record.observations);settle(world,clone(record.decisions));
  for(const [id,upgrades] of Object.entries(record.upgrades||{}))for(const decision of upgrades)if(!decision.fault)applyUpgrade(world,world.agents[id],decision.action);
  if(world.total()/100!==record.statistics.totalEnergy||JSON.stringify(world.statistics().tribes)!==JSON.stringify(record.statistics.tribes))throw new Error(`第${record.turn}回合重放不同`);
  world.history[world.history.length-1]=world.statistics();rounds++;
  world.runtime={model:record.model,service:{requests:(world.runtime?.service.requests||0)+record.requests,retries:0,failures:record.serviceFaults,inputTokens:(world.runtime?.service.inputTokens||0)+record.inputTokens,outputTokens:0,latencyMs:0},language:{requests:0,fallbacks:record.languageAudit?.filter(a=>a.error).length||0,errors:0},lastRound:{turn:record.turn,wallMs:record.wallMs,requests:record.requests,inputTokens:record.inputTokens,serviceFaults:record.serviceFaults}};
}
if(!world)throw new Error('Missing INITIAL record');
const episode=`replay-${Date.now()}`,saved={...world};for(const key of ['net','snapshotAgents','snapshotBuildings','snapshotOwners','snapshotGrants','snapshotProjects','snapshotAccounts','occupied'])delete saved[key];
const target=file.replace(/\.jsonl$/,'.checkpoint.json');await writeFile(target,JSON.stringify({episode,world:saved}));console.log(`Verified ${rounds} rounds. Wrote ${target}`);
