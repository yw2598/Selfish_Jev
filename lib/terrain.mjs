import {shuffled} from './util.mjs';

export const terrainTypes=['PLAIN','FOREST','SAND','WATER','MOUNTAIN'];
export const isLand=t=>t!=='WATER'&&t!=='MOUNTAIN';
function noise(x,y,seed){let n=Math.imul(x+seed,374761393)+Math.imul(y,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;}
function smooth(x,y,scale,seed){const a=Math.floor(x/scale),b=Math.floor(y/scale),fx=x/scale-a,fy=y/scale-b,s=t=>t*t*(3-2*t),u=s(fx),v=s(fy);return noise(a,b,seed)*(1-u)*(1-v)+noise(a+1,b,seed)*u*(1-v)+noise(a,b+1,seed)*(1-u)*v+noise(a+1,b+1,seed)*u*v;}
export function generateTerrain(config){
  const {width:w,height:h,seed}=config,tiles=Array(w*h).fill('PLAIN');if(config.terrainMode!=='decorative')return tiles;
  const zones=[[1,1],[w-7,1],[w-7,h-7],[1,h-7]],protectedCells=new Set(),index=(x,y)=>y*w+x;
  for(const [x,y]of zones)for(let dy=0;dy<6;dy++)for(let dx=0;dx<6;dx++)protectedCells.add(index(x+dx,y+dy));
  const scale=Math.max(5,Math.min(w,h)/5),rank=[];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=index(x,y);if(protectedCells.has(p))continue;const elevation=.72*smooth(x,y,scale,seed+157)+.28*smooth(x,y,scale/3,seed+23);rank.push({p,elevation});tiles[p]=smooth(x,y,scale/2,seed+313)>.49?'FOREST':'PLAIN';}
  rank.sort((a,b)=>a.elevation-b.elevation||a.p-b.p);
  for(const {p}of rank.slice(0,Math.floor(rank.length*.16)))tiles[p]='WATER';
  for(const {p}of rank.slice(-Math.floor(rank.length*.11)))tiles[p]='MOUNTAIN';
  const neighbors=p=>{const x=p%w,y=Math.floor(p/w);return [[x,y-1],[x+1,y],[x,y+1],[x-1,y]].filter(([x,y])=>x>=0&&y>=0&&x<w&&y<h).map(([x,y])=>index(x,y));};
  // Join each starting region to the map center, carving only where needed.
  // Routes prefer existing land, so clear visual passages follow the landscape.
  const center=index(Math.floor(w/2),Math.floor(h/2));tiles[center]='PLAIN';
  const reachable=()=>{const seen=new Set([center]),queue=[center];for(let i=0;i<queue.length;i++)for(const n of neighbors(queue[i]))if(isLand(tiles[n])&&!seen.has(n)){seen.add(n);queue.push(n);}return seen;};
  for(const [sx,sy]of zones){const start=index(sx+2,sy+2);let seen=reachable();if(seen.has(start))continue;
    // A monotone, seeded route has bounded length even on large maps.
    let x=sx+2,y=sy+2;const tx=Math.floor(w/2),ty=Math.floor(h/2);
    while(x!==tx||y!==ty){const choices=[];if(x!==tx)choices.push([x+Math.sign(tx-x),y]);if(y!==ty)choices.push([x,y+Math.sign(ty-y)]);choices.sort((a,b)=>(isLand(tiles[index(...a)])?0:1)-(isLand(tiles[index(...b)])?0:1)||noise(...a,seed)-noise(...b,seed));[x,y]=choices[0];const p=index(x,y);if(!isLand(tiles[p]))tiles[p]='PLAIN';}
  }
  for(let p=0;p<tiles.length;p++)if(tiles[p]==='PLAIN'&&!protectedCells.has(p)&&neighbors(p).some(n=>tiles[n]==='WATER'))tiles[p]='SAND';
  return tiles;
}

export function reachableLand(tiles,width,start){
  const height=tiles.length/width,seen=new Set([start]),queue=[start];
  for(let i=0;i<queue.length;i++){const p=queue[i],x=p%width,y=Math.floor(p/width);for(const [nx,ny]of [[x,y-1],[x+1,y],[x,y+1],[x-1,y]]){const n=ny*width+nx;if(nx>=0&&ny>=0&&nx<width&&ny<height&&isLand(tiles[n])&&!seen.has(n)){seen.add(n);queue.push(n);}}}
  return seen;
}

export function resourceTiles(config,tiles,owners){
  if(config.resourceCount===null&&config.resourceDensity<1){
    const initial=config.startingMinePerTribe?4:0;
    const full=resourceTiles({...config,resourceDensity:1},[...tiles],owners);
    const count=Math.max(0,Math.round((initial+full.length)*config.resourceDensity)-initial);
    const chosen=shuffled(full,[config.seed,'resource-density']).slice(0,count);
    if(config.terrainMode==='decorative')for(const p of chosen)if(!isLand(tiles[p]))tiles[p]='PLAIN';
    return chosen;
  }
  if(config.neutralMineLayout==='vision5'&&config.resourceCount===null)return visionMines(config,tiles,owners);
  const natural=config.terrainMode==='decorative',w=config.width,center=Math.floor(config.height/2)*w+Math.floor(w/2),reachable=natural?reachableLand(tiles,w,center):null;
  const eligible=owners.flatMap((owner,p)=>owner===null&&(!natural||isLand(tiles[p])&&reachable.has(p))?[p]:[]);
  const initial=config.startingMinePerTribe?4:0,count=config.resourceCount??(natural?initial+Math.max(4,Math.round(eligible.length/256)):Math.round(config.width*config.height/256));
  const needed=count-initial;if(needed>eligible.length)throw new Error('可达陆地不足以放置指定矿点数量');
  const pool=shuffled(eligible,[config.seed,'resources']),chosen=[];
  if(!natural)return pool.slice(0,needed);
  const distance=(a,b)=>Math.abs(a%w-b%w)+Math.abs(Math.floor(a/w)-Math.floor(b/w));
  // Spread exploration mines across quadrants before filling remaining spaces.
  for(let quadrant=0;quadrant<4&&chosen.length<needed;quadrant++){
    const p=pool.find(p=>(p%w>=w/2?1:0)+2*(Math.floor(p/w)>=config.height/2?1:0)===quadrant&&chosen.every(q=>distance(p,q)>=4));if(p!==undefined)chosen.push(p);
  }
  for(const spacing of [4,2,0]){for(const p of pool){if(chosen.length>=needed)break;if(!chosen.includes(p)&&chosen.every(q=>distance(p,q)>=spacing))chosen.push(p);}if(chosen.length>=needed)break;}
  return chosen;
}

// Cover every initially unowned tile with a neutral mine in Chebyshev radius 2.
// A regular five-tile grid does most of the work; patch holes near camps/borders.
// Terrain is cosmetic: clear only a mine's visual tile if it falls on water/rock.
function visionMines(config,tiles,owners){
  const {width:w,height:h}=config,chosen=[],covered=new Uint8Array(w*h);
  const square=p=>{const x=p%w,y=Math.floor(p/w),out=[];for(let b=Math.max(0,y-2);b<=Math.min(h-1,y+2);b++)for(let a=Math.max(0,x-2);a<=Math.min(w-1,x+2);a++)out.push(b*w+a);return out;};
  const put=p=>{chosen.push(p);for(const q of square(p))covered[q]=1;if(config.terrainMode==='decorative'&&!isLand(tiles[p]))tiles[p]='PLAIN';};
  const axis=n=>{const points=[];for(let a=2;a<n;a+=5)points.push(a);if(n-1-points.at(-1)>2)points.push(n-1);return points;};
  for(const y of axis(h))for(const x of axis(w)){const p=y*w+x;if(owners[p]===null)put(p);}
  for(let p=0;p<w*h;p++)if(owners[p]===null&&!covered[p]){
    const candidates=square(p).filter(q=>owners[q]===null);
    const score=q=>square(q).reduce((n,r)=>n+(owners[r]===null&&!covered[r]?1:0),0);
    candidates.sort((a,b)=>score(b)-score(a)||(isLand(tiles[a])?0:1)-(isLand(tiles[b])?0:1)||noise(a%w,Math.floor(a/w),config.seed)-noise(b%w,Math.floor(b/w),config.seed)||a-b);
    put(candidates[0]);
  }
  return chosen;
}
