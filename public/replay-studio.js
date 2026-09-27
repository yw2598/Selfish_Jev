import {finalizeWebM} from './webm-duration.js';
import {renderReplay} from './replay-renderer.js';
import {ReplayAudio} from './replay-audio.js';
import {normalizeClips,highlights,timeline,locate} from './replay-timeline.js';
const $=id=>document.getElementById(id),canvas=$('replayCanvas'),audio=new ReplayAudio();
let replay=null,clips=[],tl={entries:[],duration:0},time=0,playing=false,recording=false,previousTime=0,lastCue='',raf=null,recorder=null,cancelled=false,previewUrl=null,loadToken=0,catalogLoaded=false,scrubFrame=null;
const kinds={capture:'夺取敌矿',mine:'发现矿点',extinction:'种族灭绝',succession:'国王更替',battle:'首次交战',population:'人口里程碑',economy:'经济危机',edit:'人工调整',fault:'服务故障'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url,data){const r=await fetch(url,data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{});const value=await r.json();if(!r.ok)throw Error(value.error||`HTTP ${r.status}`);return value;}
function message(text,error=false){$('replayStatus').textContent=text;$('replayStatus').classList.toggle('error',error);}
function lock(on){for(const e of document.querySelectorAll('#replayPanel .replay-edit'))e.disabled=on;$('exportReplayBtn').disabled=on||!replay;$('cancelExportBtn').hidden=!on;$('replayPlayBtn').disabled=on||!replay;}
function rebuild(){if(!replay)return;scrubFrame=null;clips=normalizeClips(clips,replay.frames.at(-1).turn);tl=timeline(clips,1/Number($('replaySpeed').value));time=Math.min(time,Math.max(0,tl.duration-.001));$('replayDuration').textContent=`${clips.length} 个片段 · ${tl.duration.toFixed(1)} 秒`;
  $('clipList').innerHTML=clips.map((c,i)=>`<div class="clip-item"><span>${String(i+1).padStart(2,'0')} · T${c.start}—T${c.end}</span><div><button class="replay-edit" data-up="${i}" aria-label="上移片段 ${i+1}" ${i===0?'disabled':''}>↑</button><button class="replay-edit" data-remove="${i}" aria-label="删除片段 ${i+1}">×</button></div></div>`).join('');
  $('exportReplayBtn').disabled=!clips.length;$('replayPlayBtn').disabled=!clips.length;draw();
}
function draw(){if(!replay)return;const entry=locate(tl,time)||{turn:0,clip:0,progress:1},frame=replay.frames[scrubFrame??entry.turn];renderReplay(canvas,replay,frame,scrubFrame===null?entry.progress:1,{clip:entry.clip,clips:clips.length,elapsed:time,duration:tl.duration});$('replaySeek').value=frame.turn;$('replayTurn').textContent=`T${frame.turn} / ${replay.frames.at(-1).turn}`;$('replayClock').textContent=`${time.toFixed(1)} / ${tl.duration.toFixed(1)} s`;if(recording)$('exportProgress').value=100*time/tl.duration;}
function stop(silence=true){playing=false;if(silence)audio.stop();if(raf!==null)cancelAnimationFrame(raf);raf=null;$('replayPlayBtn').textContent='▶ 播放';}
function tick(now){
  if(!playing)return;const dt=Math.max(0,(now-previousTime)/1000);previousTime=now;time=Math.min(tl.duration,time+dt);draw();
  const entry=locate(tl,time),cue=`${entry.clip}:${entry.turn}`;if(cue!==lastCue){audio.cue(replay.frames[entry.turn]);lastCue=cue;}
  if(time>=tl.duration){stop(!recording);if(recording){const current=recorder;setTimeout(()=>{if(current?.state==='recording')current.stop();},500);}return;}raf=requestAnimationFrame(tick);
}
async function play(){if(!replay||!tl.entries.length)return;scrubFrame=null;if(playing){stop();return;}await audio.ready();audio.enabled=$('replaySound').checked;if(time>=tl.duration-.01)time=0;lastCue='';playing=true;previousTime=performance.now();$('replayPlayBtn').textContent='Ⅱ 暂停';raf=requestAnimationFrame(tick);}
function jump(turn){if(!replay||recording||!replay.frames[turn])return;stop();const e=tl.entries.find(e=>e.turn===turn);if(e)time=e.start;scrubFrame=turn;draw();}
function events(){if(!replay)return;const filter=$('replayEventFilter').value,items=replay.majorEvents.filter(e=>!filter||e.kind===filter);$('replayEventCount').textContent=`${items.length} 条`;
  $('replayEvents').innerHTML=items.map(e=>`<button class="replay-event replay-edit" data-event-turn="${e.turn}"><span class="event-turn">T${e.turn}</span><span><b>${esc(e.title)}</b><small>${esc(e.detail)}</small></span><i class="event-kind ${e.kind}">${kinds[e.kind]}</i></button>`).join('')||'<p class="hint">这段记录尚无此类重大事件。</p>';
  $('replayMarkers').innerHTML=replay.majorEvents.map(e=>`<button class="replay-edit marker ${e.kind}" style="left:${100*e.turn/Math.max(1,replay.frames.at(-1).turn)}%" data-event-turn="${e.turn}" title="T${e.turn} ${esc(e.title)}" aria-label="跳转 T${e.turn} ${esc(e.title)}"></button>`).join('');
}
function setReplay(data){
  replay=data;clips=[{start:0,end:data.frames.at(-1).turn}];time=0;$('clipStart').max=$('clipEnd').max=$('replaySeek').max=data.frames.at(-1).turn;$('clipStart').value=0;$('clipEnd').value=data.frames.at(-1).turn;
  $('replayEmpty').hidden=true;$('replayStage').hidden=false;for(const el of document.querySelectorAll('#replayPanel .needs-replay'))el.disabled=false;rebuild();events();message(`已校验 ${data.verifiedTurns} 回合 · ${data.majorEvents.length} 个重大事件${data.warnings.length?' · '+data.warnings.join('；'):''}`);
}
async function catalog(){const data=await api('/api/replays');$('replayEpisode').innerHTML=data.episodes.map(e=>`<option value="${esc(e.id)}">${e.current?'当前沙盘 · ':''}${esc(e.id)} · ${(e.bytes/1024/1024).toFixed(1)} MB</option>`).join('');catalogLoaded=true;if(!data.episodes.length)message('还没有可回放的实验记录，先在沙盘运行几个回合。');}
async function load(){
  if(recording)return;stop();const id=$('replayEpisode').value;if(!id)return;const token=++loadToken;$('loadReplayBtn').disabled=true;message('正在后台还原历史记录…');
  try{let job=await api('/api/replays/build',{id});while(job.state==='building'){if(token!==loadToken)return;message(`正在校验并准备画面 · 已完成 ${job.turn} 回合`);await new Promise(r=>setTimeout(r,800));job=await api(`/api/replays/status?id=${encodeURIComponent(id)}`);}if(job.state==='error')throw Error(job.error);const data=await api(`/api/replays/data?id=${encodeURIComponent(id)}`);if(token===loadToken)setReplay(data);}catch(e){message(`回放准备失败：${e.message}`,true);}finally{if(token===loadToken)$('loadReplayBtn').disabled=false;}
}
function showSubtab(name){if(recording)return;for(const tab of ['editor','movie']){$(`replay-${tab}`).hidden=tab!==name;const button=$(`showReplay${tab==='editor'?'Editor':'Movie'}`);button.classList.toggle('active',tab===name);button.setAttribute('aria-selected',String(tab===name));}if(name==='movie'){stop();if(!$('replayVideo').getAttribute('src'))void loadDemo();}else $('replayVideo').pause();}
async function exportVideo(){
  if(!replay||!clips.length||recording)return;
  if(!canvas.captureStream||!window.MediaRecorder)throw Error('当前浏览器不支持视频导出，请使用桌面 Edge 或 Chrome。');
  const mime=['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm'].find(m=>MediaRecorder.isTypeSupported(m));if(!mime)throw Error('当前浏览器不支持 WebM 视频编码。');
  stop();await audio.ready();audio.enabled=$('replaySound').checked;time=0;scrubFrame=null;draw();cancelled=false;recording=true;lock(true);$('exportProgress').hidden=false;message(`正在录制约 ${(tl.duration+1.25).toFixed(1)} 秒成片，请保持此页可见…`);
  document.body.classList.add('replay-recording');await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));draw();
  let stream,warmup,readyTimer,readyResolve;const chunks=[];
  try{
    stream=canvas.captureStream(30);stream.addTrack(audio.destination.stream.getAudioTracks()[0].clone());if(cancelled)return;
    const firstFrame=new Promise((resolve,reject)=>{readyResolve=resolve;readyTimer=setTimeout(()=>reject(Error('视频编码器启动超时，请重试')),8000);});
    const done=new Promise((resolve,reject)=>{recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:4500000,audioBitsPerSecond:128000});recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);if(e.data.size>1000){clearTimeout(readyTimer);readyResolve();}};recorder.onerror=e=>{stop();reject(e.error||Error('视频编码失败'));};recorder.onstop=()=>{clearTimeout(readyTimer);readyResolve();resolve();};});
    recorder.start(100);stream.getVideoTracks()[0].requestFrame?.();warmup=setInterval(()=>{draw();stream.getVideoTracks()[0].requestFrame?.();},33);await Promise.all([Promise.race([firstFrame,done]),new Promise(resolve=>setTimeout(resolve,750))]);clearInterval(warmup);if(!cancelled)await play();await done;audio.stop();
    if(cancelled){message('已取消导出，剪辑列表已保留。');return;}const rawBlob=new Blob(chunks,{type:mime});if(!rawBlob.size)throw Error('视频没有生成有效画面');const finalized=await finalizeWebM(rawBlob,(tl.duration+1.25)*1000),blob=finalized.blob;
    if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(blob);$('replayVideo').src=previewUrl;$('replayVideo').hidden=false;$('movieEmpty').hidden=true;$('movieMeta').textContent=`${replay.episode} · ${clips.length} 个片段 · ${finalized.duration.toFixed(1)} 秒（含片头片尾） · 1280×720 · ${$('replaySound').checked?'包含合成音效':'静音'} · ${(blob.size/1024/1024).toFixed(1)} MB`;
    const name=`selfish-gene-${replay.episode}-${Date.now()}.webm`;$('downloadReplayVideo').href=previewUrl;$('downloadReplayVideo').download=name;$('downloadReplayVideo').hidden=false;$('downloadReplayVideo').click();message('视频已生成并下载，可在「成片演示」中播放。');
  }finally{stop();if(recorder?.state==='recording')recorder.stop();clearInterval(warmup);clearTimeout(readyTimer);for(const t of stream?.getTracks()||[])t.stop();recording=false;recorder=null;document.body.classList.remove('replay-recording');lock(false);$('exportProgress').hidden=true;if(!cancelled&&previewUrl)showSubtab('movie');}
}
function cancelExport(){cancelled=true;stop();if(recorder?.state==='recording')recorder.stop();}
async function switchTab(tab){
  if(recording)cancelExport();if(tab!=='replay')stop();for(const name of ['sandbox','replay']){$(`${name}Panel`).hidden=name!==tab;$(`${name}Tab`).setAttribute('aria-selected',String(name===tab));$(`${name}Tab`).classList.toggle('active',name===tab);}
  if(tab!=='replay')$('replayVideo').pause();
  history.replaceState(null,'',`#${tab}`);if(tab==='replay'&&!catalogLoaded){try{await catalog();}catch(e){message(e.message,true);}if(!replay)await loadExample();}
}
$('sandboxTab').onclick=()=>switchTab('sandbox');$('replayTab').onclick=()=>switchTab('replay');
$('loadReplayBtn').onclick=load;$('refreshReplaysBtn').onclick=()=>catalog().catch(e=>message(e.message,true));$('replayPlayBtn').onclick=()=>play().catch(e=>message(e.message,true));
async function loadExample(){if(recording)return;const token=++loadToken;stop();$('loadReplayBtn').disabled=false;try{const data=await api('/api/replays/example');if(token===loadToken)setReplay(data);}catch(e){if(token===loadToken)message(e.message,true);}}
$('loadExampleReplay').onclick=loadExample;
$('replaySeek').oninput=()=>jump(Number($('replaySeek').value));$('replaySpeed').onchange=()=>{stop();time=0;rebuild();};$('replaySound').onchange=()=>{audio.enabled=$('replaySound').checked;};
$('replayEventFilter').onchange=events;
for(const id of ['replayEvents','replayMarkers'])$(id).onclick=e=>{const b=e.target.closest('[data-event-turn]');if(b)jump(Number(b.dataset.eventTurn));};
$('addReplayClip').onclick=()=>{if(!replay)return;const start=Number($('clipStart').value),end=Number($('clipEnd').value),last=replay.frames.at(-1).turn;if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>last||end<start){message(`片段范围应在 0～${last} 回合内，结束不得早于开始。`,true);return;}stop();clips.push({start,end});time=0;rebuild();message('片段已加入剪辑列表，可删除或调整顺序。');};
$('clearReplayClips').onclick=()=>{stop();clips=[];time=0;rebuild();};$('fullReplayBtn').onclick=()=>{if(!replay)return;stop();clips=[{start:0,end:replay.frames.at(-1).turn}];time=0;rebuild();};
$('highlightReplayBtn').onclick=()=>{if(!replay)return;stop();clips=highlights(replay.majorEvents,replay.frames.at(-1).turn);time=0;rebuild();message('已按灭绝、夺矿、交战等事件自动选取高光片段，可继续手动调整。');};
$('clipList').onclick=e=>{if(recording)return;const remove=e.target.closest('[data-remove]'),up=e.target.closest('[data-up]');stop();if(remove)clips.splice(Number(remove.dataset.remove),1);if(up){const i=Number(up.dataset.up);if(i>0)[clips[i-1],clips[i]]=[clips[i],clips[i-1]];}time=0;rebuild();};
$('exportReplayBtn').onclick=()=>exportVideo().catch(e=>message(`导出失败：${e.message}`,true));$('cancelExportBtn').onclick=cancelExport;
$('showReplayEditor').onclick=()=>showSubtab('editor');$('showReplayMovie').onclick=()=>showSubtab('movie');
async function loadDemo(){try{const r=await fetch('/api/replays/demo');if(!r.ok)throw Error('演示视频尚未生成，先从剪辑页导出一段视频。');const m=await r.json();$('replayVideo').src=m.url;$('replayVideo').hidden=false;$('movieEmpty').hidden=true;$('movieMeta').textContent=m.description;$('downloadReplayVideo').href=m.url;$('downloadReplayVideo').download='selfish-gene-demo.webm';$('downloadReplayVideo').hidden=false;}catch(e){message(e.message,true);}}
$('loadDemoMovie').onclick=loadDemo;
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(recording)cancelExport();else stop();}});window.addEventListener('beforeunload',()=>{audio.stop();if(previewUrl)URL.revokeObjectURL(previewUrl);});
if(location.hash==='#replay')void switchTab('replay');
