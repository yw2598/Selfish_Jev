// Original procedural pixel art. Visual biomes are all PLAIN to the rule engine.
const TILE=8,MARGIN=10;
const cache=new Map();
function noise(x,y,seed){let n=Math.imul(x+seed,374761393)+Math.imul(y,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;}
function smooth(x,y,scale,seed){const a=Math.floor(x/scale),b=Math.floor(y/scale),fx=x/scale-a,fy=y/scale-b,s=t=>t*t*(3-2*t),u=s(fx),v=s(fy);return noise(a,b,seed)*(1-u)*(1-v)+noise(a+1,b,seed)*u*(1-v)+noise(a,b+1,seed)*(1-u)*v+noise(a+1,b+1,seed)*u*v;}
export function terrain(config,biomes,stamp=''){
  const key=`${config.seed}:${config.width}:${config.height}:${config.terrainMode}:${stamp}`;if(cache.has(key))return cache.get(key);
  const canvas=document.createElement('canvas'),w=config.width,h=config.height;canvas.width=(w+MARGIN*2)*TILE;canvas.height=(h+MARGIN*2)*TILE;const c=canvas.getContext('2d');c.imageSmoothingEnabled=false;
  for(let y=-MARGIN;y<h+MARGIN;y++)for(let x=-MARGIN;x<w+MARGIN;x++){
    const px=(x+MARGIN)*TILE,py=(y+MARGIN)*TILE,r=noise(x,y,config.seed),inside=x>=0&&y>=0&&x<w&&y<h;
    const distance=Math.max(-x,-y,x-w+1,y-h+1,0),edge=smooth(x,y,6,config.seed+9);
    if(!inside){
      const sand=distance<1.5+edge*2,shallow=distance<3.5+edge*2;
      c.fillStyle=sand?['#c4b879','#d5c88d','#ddd198'][Math.floor(r*3)]:shallow?['#4d9b9d','#53a3a0','#60aaa2'][Math.floor(r*3)]:['#326e89','#34758d','#377b92'][Math.floor(r*3)];c.fillRect(px,py,TILE,TILE);
      if(r>.8){c.fillStyle=sand?'#b5aa71':shallow?'#76c0b0':'#4a92a2';c.fillRect(px+2,py+3,4,1);}
      continue;
    }
    const kind=biomes?.[y*w+x]||'PLAIN';
    if(kind==='WATER'){
      c.fillStyle=['#428b9c','#4793a1','#4b99a3'][Math.floor(r*3)];c.fillRect(px,py,TILE,TILE);
      if(r>.3){c.fillStyle='#70b7ba';c.fillRect(px+1,py+3,4,1);c.fillStyle='#397f93';c.fillRect(px+4,py+6,3,1);}continue;
    }
    if(kind==='SAND'){
      c.fillStyle=['#cbbb80','#d2c48a','#d9cb92'][Math.floor(r*3)];c.fillRect(px,py,TILE,TILE);c.fillStyle='#b5a776';c.fillRect(px+2,py+5,2,1);if(r>.6){c.fillStyle='#e5d8a2';c.fillRect(px+4,py+2,3,1);}continue;
    }
    if(kind==='MOUNTAIN'){
      c.fillStyle='#7e8871';c.fillRect(px,py,TILE,TILE);c.fillStyle='#586a65';c.fillRect(px+1,py+4,7,4);c.fillRect(px+3,py+2,4,2);c.fillStyle='#adb19a';c.fillRect(px+3,py+1,2,2);c.fillRect(px+2,py+3,3,2);c.fillStyle='#8e9988';c.fillRect(px+1,py+5,3,2);c.fillStyle='#d0cdb6';c.fillRect(px+3,py+1,1,2);continue;
    }
    if(kind==='FOREST'){
      c.fillStyle=['#668647','#6e8e4b','#73934f'][Math.floor(r*3)];c.fillRect(px,py,TILE,TILE);c.fillStyle='#635744';c.fillRect(px+3,py+5,2,3);c.fillStyle='#385b3c';c.fillRect(px+1,py+3,6,3);c.fillRect(px+2,py+1,4,5);c.fillStyle='#497543';c.fillRect(px+2,py+1,4,3);c.fillStyle='#67934e';c.fillRect(px+2,py+1,2,2);continue;
    }
    const biome=smooth(x,y,18,config.seed)+smooth(x,y,7,config.seed+17)*.35;
    const colors=biome>.85?['#6b9149','#70964c','#759b4f','#6d9149']:biome<.4?['#a2ad62','#a8b568','#aab868','#9fab60']:['#89a65c','#8fac60','#94af62','#8da75b'];
    c.fillStyle=colors[Math.floor(r*colors.length)];c.fillRect(px,py,TILE,TILE);
    c.fillStyle=biome>.85?'#7da252':biome<.4?'#b8bf79':'#9bb86d';if(r>.4){c.fillRect(px+2,py+5,1,1);c.fillRect(px+3,py+4,1,1);}
    if(r<.17){c.fillStyle='#637f42';c.fillRect(px+2,py+4,2,1);c.fillStyle='#9fb869';c.fillRect(px+2,py+3,1,1);}
    // Shrub clusters add a forest-like canopy pattern; these are passable decoration.
    if(biome>.91&&r>.66){c.fillStyle='#52713c';c.fillRect(px+1,py+3,6,3);c.fillRect(px+2,py+2,4,5);c.fillStyle='#628643';c.fillRect(px+2,py+2,4,3);c.fillStyle='#7d9b4e';c.fillRect(px+2,py+2,2,1);}
    if(biome<.39&&r>.8){c.fillStyle='#c5c581';c.fillRect(px+2,py+2,3,2);c.fillStyle='#b1b672';c.fillRect(px+4,py+4,2,1);}
  }
  const item={canvas,margin:MARGIN,tile:TILE};cache.clear();cache.set(key,item);return item;
}
const spriteCache=new Map();
function sprite(rows,palette){const key=JSON.stringify([rows,palette]);if(spriteCache.has(key))return spriteCache.get(key);const c=document.createElement('canvas');c.width=Math.max(...rows.map(r=>r.length));c.height=rows.length;const ctx=c.getContext('2d');rows.forEach((row,y)=>[...row].forEach((ch,x)=>{if(palette[ch]){ctx.fillStyle=palette[ch];ctx.fillRect(x,y,1,1);}}));spriteCache.set(key,c);return c;}
export function personSprite(color,ruler){return sprite(ruler?[
  '..Y.Y.Y..','..YYYYY..','...hhh...','...sss...','..ttttt..','..tTtTt..','...ttt...','...p.p...','..bb.bb..'
]:[
  '...hhh...','..hhhhh..','...sss...','..ttttt..','..tTtTt..','...ttt...','...p.p...','..bb.bb..'
],{h:'#5a4635',s:'#f0c494',t:color,T:'#e3d9b6',p:'#42443b',b:'#2e3a32',Y:'#ffdf77'});}
export function resourceSprite(empty){return sprite([
  '............','.....L......','....LGL.....','..L.GGg.....','..LGGGg.L...','.LGGGGgLGg..','.LGGGggGGg..','..GGggggg...','..rrRRrrr...','...rrrrr....','............','............'
],{L:empty?'#b0aa7e':'#ffeb9c',G:empty?'#8a9576':'#e7c45f',g:empty?'#69795e':'#ba923e',r:'#617747',R:'#85975d'});}
export function buildingSprite(type,color,complete=true){const palette={s:complete?'#c4c2a5':'#9b9c7c',h:'#e5ddba',d:'#7e8271',b:'#545e4e',f:color,r:'#785b43',w:'#303f34'};
  const rows=type==='WALL'?['............','.ss.ss.ss...','.hhhhhhhh...','.sdsdsdsd...','.ssdsdsds...','.sdsdsdsd...','.dddddddd...','..bbbbbb....']:type==='GATE'?['............','.ss....ss...','.hsffffsh...','.ssddddss...','.sdw..wds...','.ssw..wss...','.sdw..wds...','.ddw..wdd...']:['.....f......','.....ff.....','.....r......','.ss..r..ss..','.hhhhhhhhh..','.sddddddds..','.sshsshsss..','.sswsswsss..','.sssssssss..','.dddw.wddd..','..bbw.wbb...','............'];return sprite(rows,palette);
}
export function drawSprite(ctx,sprite,x,y,size=1){ctx.imageSmoothingEnabled=false;ctx.drawImage(sprite,x+(1-size)/2,y+(1-size)/2,size,size);}
export function toolbarIcons(){const icons={resource:resourceSprite(false),WALL:buildingSprite('WALL','#d98e60'),GATE:buildingSprite('GATE','#d98e60'),FORT:buildingSprite('FORT','#d98e60')};for(const [tool,s] of Object.entries(icons)){const button=document.querySelector(`[data-tool="${tool}"]`);if(!button)continue;const img=document.createElement('img');img.src=s.toDataURL();img.alt='';img.className='pixel-tool';button.firstChild.replaceWith(img);}}
