import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),base='http://127.0.0.1:8770';
await mkdir(new URL('../artifacts/',import.meta.url),{recursive:true});
const artifacts=await mkdtemp(root+'artifacts/services-browser-');
const upstream=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;res.setHeader('Content-Type','application/json');if(req.url.endsWith('/v1/models'))return res.end(JSON.stringify({models:[{name:'kev-latest',run:'browser-test'}]}));if(req.url==='/language/v1/chat/completions'){assert.equal(req.headers.authorization,'Bearer browser-llm-test');return res.end(JSON.stringify({choices:[{message:{content:'{"ok":true}'}}]}));}res.statusCode=404;res.end('{}');});
await new Promise(r=>upstream.listen(0,'127.0.0.1',r));const endpoint=`http://127.0.0.1:${upstream.address().port}`;
let server,browser;
async function start(){server=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,PORT:'8770',ARTIFACTS_DIR:artifacts,KEV_MANAGED_SSH:'0'}});for(let i=0;i<60;i++){try{if((await fetch(base+'/api/state')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('test server unavailable');}
async function stop(){if(!server||server.exitCode!==null)return;const exited=new Promise(r=>server.once('exit',r));server.kill();await exited;}
try{
  await start();browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/#replay');await page.waitForFunction(()=>document.getElementById('replaySeek').max==='100'&&!document.getElementById('replayStage').hidden);assert.ok(await page.locator('.replay-event').count()>100);
  await page.locator('#showReplayMovie').click();await page.waitForFunction(()=>{const v=document.getElementById('replayVideo');return v.readyState>=1&&Number.isFinite(v.duration);});assert.ok(await page.locator('#replayVideo').evaluate(v=>v.duration>29));
  await page.locator('#servicesBtn').click();await page.waitForSelector('#servicesDialog:visible');
  for(const t of ['A','B','C','D']){assert.equal(await page.locator('#jevEndpoint'+t).inputValue(),'http://127.0.0.1:8108');await page.locator('#jevEndpoint'+t).fill(endpoint+'/'+t);await page.locator('#jevKey'+t).fill('browser-team-'+t);}
  await page.locator('#languageEndpoint').fill(endpoint+'/language/v1');await page.locator('#languageModel').fill('browser-language');await page.locator('#languageKey').fill('browser-llm-test');await page.locator('#saveServicesBtn').click();await page.waitForFunction(()=>document.getElementById('serviceMessage').textContent.startsWith('已保存'));
  assert.equal(await page.locator('#languageKey').inputValue(),'');await page.locator('#testJevServicesBtn').click();await page.waitForFunction(()=>document.querySelectorAll('#serviceHealth .connected').length===4);
  await page.locator('#testLanguageServiceBtn').click();await page.waitForFunction(()=>document.getElementById('serviceMessage').textContent.includes('JSON 响应正常'));
  const config=await fetch(base+'/api/services').then(r=>r.json());assert.equal(config.keys.language,true);for(const t of ['A','B','C','D']){assert.equal(config.teams[t].endpoint,endpoint+'/'+t);assert.equal(config.keys[t],true);}
  for(const route of ['/api/state','/api/report','/api/scenario','/api/services'])assert.ok(!(await fetch(base+route).then(r=>r.text())).includes('browser-llm-test'));
  assert.ok(!(await readFile(artifacts+'/latest.checkpoint.json','utf8')).includes('browser-llm-test'));
  await page.screenshot({path:root+'artifacts/services-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await page.locator('#servicesDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:root+'artifacts/services-mobile.png',fullPage:true});
  await stop();await start();const restored=await fetch(base+'/api/services').then(r=>r.json());assert.deepEqual(restored.teams,config.teams);assert.deepEqual(restored.keys,config.keys);assert.equal((await fetch(base+'/api/state').then(r=>r.json())).turn,0);
  assert.deepEqual(errors,[]);const result={passed:true,teams:4,keysPersisted:true,secretsExcluded:true,defaultDemoTurns:100,defaultMovie:true,mobile:true,errors};await writeFile(root+'artifacts/services-browser-validation.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();await stop();await new Promise(r=>{upstream.close(r);upstream.closeAllConnections();});}
