export function normalizeClips(clips,last){
  return clips.map(c=>({start:Math.max(0,Math.min(last,Math.round(Number(c.start)))),end:Math.max(0,Math.min(last,Math.round(Number(c.end))))})).filter(c=>Number.isFinite(c.start)&&Number.isFinite(c.end)&&c.end>=c.start);
}
export function highlights(events,last){
  const selected=[{start:0,end:Math.min(3,last)},{start:Math.max(0,last-2),end:last},...events.filter(e=>e.kind!=='edit'&&e.kind!=='fault').sort((a,b)=>b.score-a.score||a.turn-b.turn).slice(0,8).map(e=>({start:Math.max(0,e.turn-2),end:Math.min(last,e.turn+1)}))].sort((a,b)=>a.start-b.start);
  const result=[];for(const c of selected){const old=result.at(-1);if(old&&c.start<=old.end+1)old.end=Math.max(old.end,c.end);else result.push({...c});}return result;
}
export function timeline(clips,secondsPerTurn){
  let duration=0;const entries=[];clips.forEach((c,clip)=>{for(let turn=c.start;turn<=c.end;turn++){entries.push({turn,clip,start:duration,end:duration+secondsPerTurn});duration+=secondsPerTurn;}});return {entries,duration};
}
export function locate(tl,time){
  const entry=tl.entries.find(e=>time<e.end)||tl.entries.at(-1);return entry?{...entry,progress:Math.max(0,Math.min(1,(time-entry.start)/(entry.end-entry.start)))}:null;
}
