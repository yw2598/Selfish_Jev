export class MovementEffects{
  constructor({reducedMotion=false}={}){this.reducedMotion=reducedMotion;this.episode=null;this.turn=null;this.moves=new Map();}
  update(state,now){
    const episode=state.status.episode;
    if(episode===this.episode&&state.turn===this.turn)return;
    const continuous=episode===this.episode&&state.turn===this.turn+1;
    this.episode=episode;this.turn=state.turn;this.moves.clear();
    if(!continuous||this.reducedMotion)return;
    const delay=state.combatEvents?.length?320:0;
    for(const e of state.movementEvents||[]){
      if(e.result!=='OK'||!Array.isArray(e.path)||e.path.length<2)continue;
      if(e.path.some((p,i)=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isFinite(v))||i&&Math.abs(p[0]-e.path[i-1][0])+Math.abs(p[1]-e.path[i-1][1])!==1))continue;
      this.moves.set(e.actor,{path:e.path,start:now+delay,duration:650+(e.path.length-2)*140});
    }
  }
  position(agent,width,now){
    const m=this.moves.get(agent.id),end=[agent.p%width,Math.floor(agent.p/width)];
    if(!m)return end;
    const t=Math.max(0,(now-m.start)/m.duration);
    if(t>=1){this.moves.delete(agent.id);return end;}
    const progress=(t*t*(3-2*t))*(m.path.length-1),i=Math.min(m.path.length-2,Math.floor(progress)),f=progress-i;
    return m.path[i].map((v,k)=>v+(m.path[i+1][k]-v)*f);
  }
}
