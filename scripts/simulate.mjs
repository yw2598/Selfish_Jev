import { readFile,writeFile,appendFile,mkdir } from 'node:fs/promises';
import { World } from '../lib/world.mjs';
import { Simulation } from '../lib/policy.mjs';
import { validateConfig,mergeConfig,hash } from '../lib/util.mjs';
const args=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const base=JSON.parse(await readFile(new URL('../defaults.json',import.meta.url),'utf8'));
const patch={};if(args.population)patch.population=Number(args.population);if(args.seed)patch.seed=Number(args.seed);if(args.port)patch.kev={endpoint:`http://127.0.0.1:${args.port}`};
const config=validateConfig(mergeConfig(base,patch)),world=new World(config),simulation=new Simulation(world);
const name=args.name||`baseline-${config.seed}-${Date.now()}`,dir=new URL('../artifacts/',import.meta.url);await mkdir(dir,{recursive:true});
const log=new URL(`${name}.jsonl`,dir);await writeFile(log,JSON.stringify({kind:'INITIAL',config,configHash:hash(config),fineTunedForSandbox:false})+'\n');
const info=await simulation.client.health();console.log(JSON.stringify({model:info.run,population:config.population*4,seed:config.seed}));
const results=[];
for(let i=0;i<Number(args.turns||10);i++){
  const r=await simulation.step();await appendFile(log,JSON.stringify({kind:'ROUND',...r})+'\n');
  const summary={turn:r.turn,wallSeconds:Number((r.wallMs/1000).toFixed(2)),requests:r.requests,inputTokens:r.inputTokens,faults:r.serviceFaults,conservationError:r.conservation.error,population:world.alive().length};results.push(summary);console.log(JSON.stringify(summary));
  if(r.serviceFaults){console.error('Service faults: episode invalid; stopping rather than continuing with fault-induced WAIT actions.');break;}
}
const report={name,config,configHash:hash(config),model:info,fineTunedForSandbox:false,validForEvaluation:results.every(r=>r.faults===0),languageMode:config.language.endpoint?'shared-llm':'deterministic-fallback',rounds:results,statistics:world.statistics(),history:world.history,service:simulation.client.stats,language:simulation.language.stats};
await writeFile(new URL(`${name}.report.json`,dir),JSON.stringify(report,null,2));
await writeFile(new URL(`${name}.state.json`,dir),JSON.stringify(world.exportState()));
const saved={...world};for(const k of ['net','snapshotAgents','snapshotBuildings','snapshotOwners','snapshotGrants','snapshotProjects','snapshotAccounts','occupied'])delete saved[k];
await writeFile(new URL(`${name}.checkpoint.json`,dir),JSON.stringify({episode:name,world:saved}));
console.log(`Saved ${name}.report.json`);
