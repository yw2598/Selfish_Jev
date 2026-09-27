import {canonical,clone,hash} from './util.mjs';
import {Compressor} from './context.mjs';

export function privateMemory(owner,sources,turn,config){
  const active=sources.filter(s=>s.owner_id===owner&&s.available_turn<=turn&&s.expires_turn>turn).sort((a,b)=>a.event_turn-b.event_turn||a.id.localeCompare(b.id));
  const selected=[];let chars=0;
  for(const s of [...active].reverse()){
    const size=Array.from(canonical(s)).length;
    if(selected.length>=config.recent&&(selected.length>=config.memory.count||chars+size>config.memory.chars))break;
    selected.push(clone(s));chars+=size;
  }
  return {recent_raw:selected.reverse(),summaries:[],active_source_count:active.length,omitted_source_count:active.length-selected.length,as_of_turn:turn,compression:'none-private-raw'};
}

// Only delivered tribal broadcasts enter the language compressor. Each recipient
// still sees exactly their authorized source set (newborns may have fewer sources).
export class SharedMemory {
  constructor(config,language){this.compressor=new Compressor(config,language);this.pending=new Map();this.tails=new Map();this.turn=null;}
  async prepare(agent,turn){
    if(this.turn!==turn){this.turn=turn;this.pending.clear();}
    const owner=`tribe:${agent.tribe}`,originals=new Map();
    const sources=agent.inbox.filter(s=>s.owner_id===agent.id&&s.provenance==='group_report'&&s.message_id&&s.sender_id?.startsWith(agent.tribe)&&s.available_turn<=turn&&s.expires_turn>turn).map(s=>{
      const id=`${owner}:${s.id.slice(agent.id.length+1)}`;originals.set(id,s);
      return {...clone(s),id,owner_id:owner};
    }).sort((a,b)=>a.event_turn-b.event_turn||a.id.localeCompare(b.id));
    const key=hash({owner,sources});
    if(!this.pending.has(key)){
      const job=(this.tails.get(owner)||Promise.resolve()).then(()=>this.compressor.prepare(owner,'shared','communication',sources,turn));
      this.tails.set(owner,job.catch(()=>{}));this.pending.set(key,job);
    }
    const shared=clone(await this.pending.get(key));
    shared.recent_raw=shared.recent_raw.map(s=>clone(originals.get(s.id)));
    shared.summaries=shared.summaries.map(s=>({...s,source_ids:s.source_ids.map(id=>originals.get(id).id)}));
    return {...shared,scope:'tribe-shared',tribe_id:agent.tribe};
  }
}
