import {terrain,drawSprite,personSprite,resourceSprite,buildingSprite} from './pixel-art.js';
import {factions,drawEmblem,drawTerritoryFlags} from './factions.js';
const clamp=v=>Math.max(0,Math.min(1,v)),ease=v=>v*v*(3-2*v);
export function renderReplay(canvas,replay,frame,progress=1,{clip=0,clips=1,elapsed=0,duration=1}={}){
  const c=canvas.getContext('2d'),W=1280,H=720;c.clearRect(0,0,W,H);c.fillStyle='#0d1d22';c.fillRect(0,0,W,H);c.imageSmoothingEnabled=false;
  const text=(s,x,y,size=16,color='#eaf1e0',weight=400)=>{c.fillStyle=color;c.font=`${weight} ${size}px "Microsoft YaHei",sans-serif`;c.textAlign='left';c.textBaseline='alphabetic';c.fillText(s,x,y);};
  text('自私的基因',32,43,26,'#f5e6bb',700);text('开源Jev的强化学习生存训练',226,41,14,'#99b2ad');text(`回放演示 · 片段 ${clip+1}/${clips}`,984,40,15,'#99b2ad');
  const {width:w,height:h}=replay.config,scale=Math.min(594/w,594/h),mx=30+(594-w*scale)/2,my=75+(594-h*scale)/2;
  c.save();c.beginPath();c.rect(24,67,610,610);c.clip();c.translate(mx,my);c.scale(scale,scale);const art=terrain(replay.config,replay.biomes,replay.episode);c.drawImage(art.canvas,-art.margin,-art.margin,w+art.margin*2,h+art.margin*2);
  const owners=new Map(frame.owners);
  for(const [p,t]of frame.owners){const x=p%w,y=Math.floor(p/w),f=factions[t];c.fillStyle=f.color+'65';c.fillRect(x,y,1,1);c.strokeStyle=f.color;c.lineWidth=1.4/scale;c.beginPath();for(const [q,x1,y1,x2,y2]of [[y>0?p-w:-1,x,y,x+1,y],[y<h-1?p+w:-1,x,y+1,x+1,y+1],[x>0?p-1:-1,x,y,x,y+1],[x<w-1?p+1:-1,x+1,y,x+1,y+1]])if(owners.get(q)!==t){c.moveTo(x1,y1);c.lineTo(x2,y2);}c.stroke();}
  for(const [p,r]of Object.entries(frame.resources)){const x=Number(p)%w,y=Math.floor(Number(p)/w);drawSprite(c,resourceSprite(!owners.has(Number(p))&&!r.stock),x,y,1);}
  for(const [p,b]of Object.entries(frame.buildings))drawSprite(c,buildingSprite(b.type,factions[b.tribe].color,b.complete),Number(p)%w,Math.floor(Number(p)/w),1.05);
  drawTerritoryFlags(c,frame.owners,w,h,scale);
  for(const a of frame.agents){
    let [x,y]=a.position;const move=frame.movements.find(m=>m.actor===a.id),p=ease(clamp((progress-.16)/.69));
    if(move?.path?.length>1&&p<1){const v=p*(move.path.length-1),i=Math.min(move.path.length-2,Math.floor(v)),f=v-i;[x,y]=move.path[i].map((n,k)=>n+(move.path[i+1][k]-n)*f);}
    drawSprite(c,personSprite(factions[a.tribe].color,a.ruler),x,y,1.04);c.fillStyle=factions[a.tribe].dark;c.fillRect(x+.68,y-.03,.36,.36);drawEmblem(c,a.tribe,x+.7,y-.01,.32);
  }
  if(progress<.85)for(const e of frame.combat){const from=e.from.map(v=>v+.5),to=e.to.map(v=>v+.5),t=clamp(progress/.24);c.strokeStyle=factions[e.actor[0]]?.color||'#fff';c.lineWidth=.13;c.beginPath();c.moveTo(...from);c.lineTo(from[0]+(to[0]-from[0])*t,from[1]+(to[1]-from[1])*t);c.stroke();if(t===1){c.strokeStyle=e.killed?'#ff684d':'#ffe8a2';c.beginPath();c.arc(...to,.35+progress*.5,0,Math.PI*2);c.stroke();if(e.killed){c.beginPath();c.moveTo(to[0]-.25,to[1]-.25);c.lineTo(to[0]+.25,to[1]+.25);c.moveTo(to[0]+.25,to[1]-.25);c.lineTo(to[0]-.25,to[1]+.25);c.stroke();}}}
  for(const e of frame.major.filter(e=>e.position)){const [x,y]=e.position;c.strokeStyle=e.kind==='extinction'?'#ff7b63':'#fff5b9';c.lineWidth=2.5/scale;c.beginPath();c.arc(x+.5,y+.5,.65+Math.sin(progress*Math.PI)*.5,0,Math.PI*2);c.stroke();}
  c.restore();c.strokeStyle='#456057';c.strokeRect(24,67,610,610);
  text(`回合 ${String(frame.turn).padStart(3,'0')}`,660,100,34,'#fff0c4',700);const population=frame.agents.length;text(`${population} 人存活 · 规则 ${frame.rulesVersion}`,662,126,15,'#9eb5a9');
  frame.tribes.forEach((t,i)=>{const y=150+i*87,f=factions[t.tribe];c.fillStyle=t.population?'#19302f':'#162627';c.fillRect(656,y,594,76);c.fillStyle=f.color;c.fillRect(656,y,4,76);drawEmblem(c,t.tribe,670,y+12,38);text(f.name,722,y+29,20,f.color,700);text(`${t.population} 人`,1122,y+31,24,t.population?'#f4ebce':'#a57973',700);text(`矿点 ${t.controlledResources}   领地 ${t.territory} 格   公账 ${t.publicEnergy.toFixed(1)} E`,722,y+56,14,'#adbfaf');if(!t.population)text('已灭绝',1150,y+58,12,'#cb8778');});
  const major=[...frame.major].sort((a,b)=>b.score-a.score),event=major[0];c.fillStyle=event?.kind==='extinction'?'#48282c':'#213b36';c.fillRect(656,514,594,116);
  if(event){text('重大事件',674,540,12,'#d5c893',700);text(event.title,674,574,24,'#fff0cb',700);text(event.detail,674,602,14,'#c2cdb7');if(major.length>1)text(`+${major.length-1} 条事件`,1158,538,12,'#d5c893');}
  else{text('生存、扩张与竞争',674,550,22,'#d6dfc7',700);text(`本回合：${frame.movements.length} 次移动 · ${frame.combat.length} 次攻击 · ${frame.births.length} 次出生`,674,583,16,'#a9c1b1');}
  text(frame.valid?'历史记录重建 · 未调用模型': '含故障或人工调参 · 保留实际轨迹',660,658,13,frame.valid?'#829c91':'#e0a67e');
  c.fillStyle='#29423e';c.fillRect(24,691,1226,5);c.fillStyle='#70d5ac';c.fillRect(24,691,1226*clamp(elapsed/Math.max(.001,duration)),5);text(`${replay.episode}  /  ${replay.config.width} × ${replay.config.height}`,26,713,10,'#6f9187');text(`${elapsed.toFixed(1)}s / ${duration.toFixed(1)}s`,1118,713,10,'#6f9187');
}
