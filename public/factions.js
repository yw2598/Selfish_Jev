export const factions={
  A:{name:'混沌战帮',subtitle:'纯个人生存',color:'#ec6554',dark:'#321c29',shape:'chaos'},
  B:{name:'阿美瑞卡',subtitle:'自利为主',color:'#559cf0',dark:'#152a50',shape:'shield'},
  C:{name:'神圣泰拉',subtitle:'群体为主',color:'#e4b947',dark:'#3b2c17',shape:'eagle'},
  D:{name:'蜂巢意志',subtitle:'无自私基因 · 全种群生存',color:'#57d6b0',dark:'#123c36',shape:'hive'}
};
// Shared vector geometry keeps the card, unit badge and map flag identical.
const star='M16 8L18 13L23 13L19 16L20.5 21L16 18L11.5 21L13 16L9 13L14 13Z';
const shapes={
  chaos:[['M16 1L20 8L17.5 8L17.5 12L21 8.5L19 7L27 5L25 13L23 11L19.5 14.5L24 14.5L24 12L31 16L24 20L24 17.5L19.5 17.5L23 21L25 19L27 27L19 25L21 23L17.5 19.5L17.5 24L20 24L16 31L12 24L14.5 24L14.5 19.5L11 23L13 25L5 27L7 19L9 21L12.5 17.5L8 17.5L8 20L1 16L8 12L8 14.5L12.5 14.5L9 11L7 13L5 5L13 7L11 9L14.5 12.5L14.5 8L12 8Z','color'],['M16 12L20 16L16 20L12 16Z','white']],
  shield:[['M3 3H29V17Q27 26 16 31Q5 26 3 17Z','white'],['M5 5H27V12H5Z','blue'],['M5 14H27V18H5ZM8 21H24L20 25H12Z','red'],[star,'white']],
  eagle:[['M2 5L12 10L14 7L11 5L15 2L16 5L17 2L21 5L18 7L20 10L30 5L27 15L22 13L27 20L20 17L23 26L18 23L16 31L14 23L9 26L12 17L5 20L10 13L5 15Z','color'],['M14 11H18V22H14ZM11 14H21V17H11Z','white']],
  hive:[['M16 1L30 9V23L16 31L2 23V9Z','color'],['M16 5L22 8.5V15.5L16 19L10 15.5V8.5ZM9 18L14 21V27L9 24L5 22V16ZM23 18L27 16V22L23 24L18 27V21Z','dark']]
};
const ink=(f,c)=>({color:f.color,dark:f.dark,white:'#fff4da',red:'#df594c',blue:'#244d94'})[c];
export function emblemSvg(id,cls='faction-emblem'){
  const f=factions[id];return `<svg class="${cls}" viewBox="0 0 32 32" role="img" aria-label="${f.name}徽记">${shapes[f.shape].map(([d,c])=>`<path d="${d}" fill="${ink(f,c)}"/>`).join('')}</svg>`;
}
export function drawEmblem(ctx,id,x,y,size){const f=factions[id];ctx.save();ctx.translate(x,y);ctx.scale(size/32,size/32);for(const [d,c]of shapes[f.shape]){ctx.fillStyle=ink(f,c);ctx.fill(new Path2D(d));}ctx.restore();}
export function drawTerritoryFlags(ctx,owners,width,height,scale){
  const map=new Map(owners),seen=new Set(),largest={};
  for(const [start,tribe]of owners){if(seen.has(start))continue;const cells=[start];seen.add(start);for(let i=0;i<cells.length;i++){const p=cells[i],x=p%width,y=Math.floor(p/width);for(const q of [y>0?p-width:-1,x<width-1?p+1:-1,y<height-1?p+width:-1,x>0?p-1:-1])if(!seen.has(q)&&map.get(q)===tribe){seen.add(q);cells.push(q);}}if(!largest[tribe]||cells.length>largest[tribe].length)largest[tribe]=cells;}
  for(const [id,cells]of Object.entries(largest)){
    if(cells.length<4)continue;const f=factions[id],cx=cells.reduce((n,p)=>n+p%width,0)/cells.length,cy=cells.reduce((n,p)=>n+Math.floor(p/width),0)/cells.length;
    const p=cells.reduce((a,b)=>Math.hypot(b%width-cx,Math.floor(b/width)-cy)<Math.hypot(a%width-cx,Math.floor(a/width)-cy)?b:a),size=Math.max(.85,23/scale),plate=size*3.5,x=Math.max(0,Math.min(width-plate,p%width-plate/2+.5)),y=Math.max(0,Math.min(height-size,Math.floor(p/width)-size/2+.5));
    ctx.save();ctx.fillStyle=f.dark+'ec';ctx.fillRect(x,y,plate,size);ctx.strokeStyle=f.color;ctx.lineWidth=1.5/scale;ctx.strokeRect(x,y,plate,size);drawEmblem(ctx,id,x+.1*size,y+.1*size,size*.8);ctx.fillStyle='#fff6df';ctx.font=`bold ${size*.39}px sans-serif`;ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(f.name,x+size*1.03,y+size*.52,plate-size*1.15);ctx.restore();
  }
}
export const geneLogo='<svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="11" fill="#203c35"/><path d="M11 6C11 19 29 21 29 34M29 6C29 19 11 21 11 34" stroke="#d8c580" stroke-width="3" fill="none"/><path d="M13 9H27M16 15H24M16 25H24M13 31H27" stroke="#78d9b8" stroke-width="2"/></svg>';
