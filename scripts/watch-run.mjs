import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const manifest=JSON.parse(readFileSync('artifacts/100-turn-run.json','utf8'));
let prior='',failures=0;
for(;;){
  try{
    const s=await(await fetch('http://127.0.0.1:8765/api/state',{signal:AbortSignal.timeout(10000)})).json();
    if(s.status.episode!==manifest.episode)throw new Error('Experiment changed');
    const summary={at:new Date().toISOString(),turn:s.turn,running:s.status.running,busy:s.status.busy,progress:s.status.progress,tribes:s.statistics.tribes.map(t=>({tribe:t.tribe,pop:t.population,energy:t.energy,public:t.publicEnergy,harvest:t.harvested,births:t.births,deaths:t.deaths,territory:t.territory})),kev:s.status.stats,language:s.status.languageStats,error:s.status.error};
    const next=JSON.stringify([s.turn,s.status.progress,s.status.languageStats]);if(next!==prior){console.log(JSON.stringify(summary));prior=next;}
    writeFileSync('artifacts/100-turn-progress.json',JSON.stringify(summary,null,2));failures=0;
    if(!s.status.running&&!s.status.busy){
      writeFileSync('artifacts/100-turn-final-state.json',JSON.stringify(s));
      const report=await(await fetch('http://127.0.0.1:8765/api/report')).json();writeFileSync('artifacts/100-turn-final-report.json',JSON.stringify(report,null,2));
      if(s.turn){
        spawnSync(process.execPath,['scripts/analyze-run.mjs',`artifacts/${manifest.episode}.jsonl`],{stdio:'inherit',windowsHide:true});
        spawnSync(process.execPath,['scripts/render-run.mjs',`artifacts/${manifest.episode}-analysis.json`],{stdio:'inherit',windowsHide:true});
      }
      if(s.status.error)process.exitCode=1;break;
    }
  }catch(error){console.error(error.message);if(++failures>=3)throw error;}
  await new Promise(resolve=>setTimeout(resolve,5000));
}
