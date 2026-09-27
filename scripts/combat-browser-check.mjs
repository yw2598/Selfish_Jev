import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {World} from '../lib/world.mjs';
import {candidates} from '../lib/actions.mjs';
import {settle} from '../lib/settle.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),base='http://127.0.0.1:8767';
const server=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,PORT:'8767',ARTIFACTS_DIR:fileURLToPath(new URL('../artifacts/combat-browser/',import.meta.url))}});
let browser;
try{
  let baseline;for(let i=0;i<50;i++){try{baseline=await fetch(`${base}/api/state`).then(r=>r.json());break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(baseline);
  const defaults=JSON.parse(await readFile(new URL('../defaults.json',import.meta.url),'utf8'));
  const w=new World({...defaults,population:1,resourceCount:0,startingMinePerTribe:false,subsistencePayment:0,nationalPolicyEnabled:false});
  const [a,b]=w.alive();a.p=w.index(15,15);b.p=w.index(17,16);
  const status={...baseline.status,episode:'combat-visual-fixture',running:false,busy:false,error:null,modelStatus:'connected'};
  let published={...w.exportState(),status};
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1512,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/state',route=>route.fulfill({json:published}));await page.route('**/api/health',route=>route.fulfill({json:{ok:true}}));
  await page.goto(base);await page.waitForSelector('.tribe-card');
  await page.locator('#zoomInBtn').click();await page.locator('#zoomInBtn').click();
  w.prepare();for(const agent of w.alive())w.lastObservations[agent.id]=w.observation(agent);
  const attack=candidates(w,a,w.lastObservations[a.id]).find(l=>l.action.type==='ATTACK'&&l.action.target===b.id).action;
  settle(w,Object.fromEntries(w.alive().map(agent=>[agent.id,{action:agent.id===a.id?attack:{type:'WAIT'}}])));
  published={...w.exportState(),status};assert.equal(published.combatEvents[0].killed,true);
  await page.waitForFunction(()=>Number(document.getElementById('mapCanvas').dataset.combatEffects)>0);
  await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});
  await page.screenshot({path:'artifacts/combat-projectile.png',fullPage:true});
  await page.waitForTimeout(330);await page.screenshot({path:'artifacts/combat-impact.png',fullPage:true});
  await page.waitForFunction(()=>document.getElementById('mapCanvas').dataset.combatEffects==='0');
  await page.waitForTimeout(1500);assert.equal(await page.locator('#mapCanvas').getAttribute('data-combat-effects'),'0');
  assert.deepEqual(errors,[]);console.log('PASS: real settled three-cell attack animates projectile, hit and kill; expires without replaying on state polls.');
}finally{await browser?.close();server.kill();}
