import {factions,emblemSvg} from './factions.js';
const $=id=>document.getElementById(id),teams=['A','B','C','D'];
const button=document.createElement('button');button.id='servicesBtn';button.textContent='服务端点';$('settingsBtn').before(button);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
$('teamServiceFields').innerHTML=teams.map(t=>`<section class="service-card" style="--service-color:${factions[t].color}"><h3><span class="service-emblem">${emblemSvg(t)}</span>${t} · ${factions[t].name}</h3><label>Jev Service 端点<input id="jevEndpoint${t}" type="url" autocomplete="off" placeholder="http://127.0.0.1:8108"></label><label>模型名称<input id="jevModel${t}" autocomplete="off" placeholder="kev-latest"></label><label>API 密钥（可选）<input id="jevKey${t}" type="password" autocomplete="new-password" placeholder="留空保留已保存密钥"></label><label class="service-check"><input id="jevClearKey${t}" type="checkbox">清除该端点的密钥</label><small id="jevKeyStatus${t}"></small></section>`).join('');
function message(text,error=false){$('serviceMessage').textContent=text;$('serviceMessage').classList.toggle('error',error);}
async function api(url,data){const r=await fetch(url,data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{}),v=await r.json();if(!r.ok)throw Error(v.error||`HTTP ${r.status}`);return v;}
function fill(data){
  for(const t of teams){$('jevEndpoint'+t).value=data.teams[t].endpoint;$('jevModel'+t).value=data.teams[t].model;$('jevKey'+t).value='';$('jevClearKey'+t).checked=false;$('jevKeyStatus'+t).textContent=data.keys?.[t]?'此端点已配置密钥（不回显）':'此端点未配置密钥';}
  $('languageEndpoint').value=data.language.endpoint;$('languageModel').value=data.language.model;$('languageKey').value='';$('languageClearKey').checked=false;$('languageKeyStatus').textContent=data.keys?.language?'此端点已配置密钥（不回显）':'此端点未配置密钥';renderHealth(data.status);
}
function renderHealth(status){$('serviceHealth').innerHTML=teams.map(t=>{const s=status?.[t],state=s?.connection.status||'unchecked';return `<div><b>${t} · ${factions[t].name}</b><span class="${state}">${state==='connected'?'已连接':state==='offline'?'连接失败':'待检测'}</span><small>${esc(s?.connection.error||s?.endpoint||'')}</small></div>`;}).join('');}
async function action(fn){for(const b of document.querySelectorAll('#servicesDialog .dialog-actions button'))b.disabled=true;try{await fn();}catch(e){message(e.message,true);}finally{for(const b of document.querySelectorAll('#servicesDialog .dialog-actions button'))b.disabled=false;}}
button.onclick=()=>action(async()=>{fill(await api('/api/services'));message('修改端点后保存即可生效，不会重置地图。');$('servicesDialog').showModal();$('servicesDialog').scrollTop=0;});
$('saveServicesBtn').onclick=()=>action(async()=>{
  const data={teams:{},language:{endpoint:$('languageEndpoint').value.trim(),model:$('languageModel').value.trim()},keys:{}};
  for(const t of teams){data.teams[t]={endpoint:$('jevEndpoint'+t).value.trim(),model:$('jevModel'+t).value.trim()};if($('jevClearKey'+t).checked)data.keys[t]='';else if($('jevKey'+t).value.trim())data.keys[t]=$('jevKey'+t).value.trim();}
  if($('languageClearKey').checked)data.keys.language='';else if($('languageKey').value.trim())data.keys.language=$('languageKey').value.trim();
  fill(await api('/api/services',data));message('已保存。下回合按所属队伍使用对应 Jev 服务。');
});
$('defaultServicesBtn').onclick=()=>action(async()=>{const d=await api('/api/defaults');fill({teams:Object.fromEntries(teams.map(t=>[t,{endpoint:d.kev.teams?.[t]?.endpoint||d.kev.endpoint,model:d.kev.teams?.[t]?.model||d.kev.model}])),language:d.language});message('已填入当前默认服务；点击保存后生效，已有密钥按端点匹配使用。');});
$('testJevServicesBtn').onclick=()=>action(async()=>{message('正在检测四队已保存的 Jev 服务…');const d=await api('/api/health');renderHealth(d.services);message(d.ok?'四队 Jev 服务均已连接。':'部分队伍连接失败，请查看各队状态。',!d.ok);});
$('testLanguageServiceBtn').onclick=()=>action(async()=>{message('正在向已保存的 LLM 发送一条简短测试请求…');const d=await api('/api/services/test-language',{});message(d.message,!d.ok);});
$('servicesDialog').addEventListener('close',()=>{for(const el of document.querySelectorAll('#servicesDialog input[type=password]'))el.value='';});
