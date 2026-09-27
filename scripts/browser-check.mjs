import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1512,height:1100},deviceScaleFactor:1}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});
const root=fileURLToPath(new URL('../',import.meta.url));
const base='http://127.0.0.1:8766';
const testServer=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,PORT:'8766',ARTIFACTS_DIR:fileURLToPath(new URL('../artifacts/browser-check/',import.meta.url))}});
let ready=false;for(let i=0;i<50;i++){try{const r=await fetch(`${base}/api/state`);if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
if(!ready){testServer.kill();await browser.close();throw new Error('Isolated browser-test server failed to start');}
async function post(route,data){const r=await fetch(`${base}${route}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await r.json();assert.equal(r.ok,true,JSON.stringify(result));return result;}
try{
  const defaults=await fetch(`${base}/api/defaults`).then(r=>r.json());await post('/api/reset',{config:defaults});
  await page.goto(base);await page.waitForSelector('.tribe-card');await page.waitForFunction(()=>document.getElementById('connectionLabel').textContent!=='检测 Kev…');
  assert.equal(await page.locator('#mapSize').textContent(),'24 × 24');
  assert.equal(await page.locator('#populationStat').textContent(),'20');
  assert.equal(await page.locator('#populationLimitStat').textContent(),'/ 100 上限');
  assert.equal(await page.locator('.tribe-heading > small').first().textContent(),'/ 50 人');
  await page.screenshot({path:'artifacts/ui-test-overview.png',fullPage:true});
  const dimensions=await page.evaluate(()=>{const map=document.getElementById('mapWrap').getBoundingClientRect(),panel=document.querySelector('.map-panel').getBoundingClientRect();return {map:map.width,panel:panel.width};});assert.ok(Math.abs(dimensions.panel-dimensions.map)<=2);
  await page.locator('[data-camp=A]').click();await page.waitForSelector('#inspectPromptBtn');await page.waitForFunction(()=>parseInt(document.getElementById('zoomLabel').textContent)>100);
  await page.screenshot({path:'artifacts/ui-test-zoom.png',fullPage:true});
  await page.locator('#agentView').click();await page.locator('#inspectPromptBtn').click();await page.waitForSelector('#promptDialog[open]');
  const observation=JSON.parse(await page.locator('#promptContent').textContent());assert.ok(observation.self.id);assert.ok(observation.local_view.plain_tile_runs);assert.ok(observation.local_view.observed_agents.every(a=>!('energy' in a)));
  await page.locator('#showRulesBtn').click();assert.match(await page.locator('#promptContent').textContent(),/长期生存/);await page.locator('#promptDialog button[aria-label="关闭"]').click();
  await page.locator('#globalView').click();await page.locator('#fitBtn').click();await page.locator('[data-tool=resource]').click();
  const bounds=await page.locator('#mapCanvas').boundingBox();await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
  await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('已编辑'));
  const edited=await fetch(`${base}/api/state`).then(r=>r.json());assert.ok(edited.interventions.some(i=>i.type==='MAP_EDIT'));assert.ok(edited.resources[Math.floor(edited.config.height/2)*edited.config.width+Math.floor(edited.config.width/2)]);
  await page.locator('#settingsBtn').click();await page.locator('[data-config="survivalCost"]').fill('0.8');await page.locator('[data-config="survivalCost"]').dispatchEvent('change');await page.locator('#applyConfigBtn').click();await page.waitForFunction(()=>!document.getElementById('settingsDialog').open);
  assert.equal((await fetch(`${base}/api/state`).then(r=>r.json())).config.survivalCost,.8);
  const downloadPromise=page.waitForEvent('download');await page.locator('#exportMapBtn').click();const download=await downloadPromise;assert.match(download.suggestedFilename(),/kev-map/);
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'artifacts/ui-test-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS: desktop/mobile, pixel canvas, zoom, role view, prompt, map paint, parameter update, map export; no page errors.');
}finally{
  await browser.close();testServer.kill();
}
