// Effects use settled coordinates: dead targets and units that moved after
// being attacked must still be hit at the actual combat position.
export class CombatEffects {
  constructor({reducedMotion=false}={}){this.reducedMotion=reducedMotion;this.key=null;this.effects=[];}
  update(state,now){
    const key=`${state.status.episode}:${state.turn}`;
    if(key===this.key)return;
    const previous=this.key;this.key=key;this.effects=[];
    if(!previous||state.turn===0)return;
    this.effects=(state.combatEvents||state.events||[]).filter(e=>e.type==='ATTACK'&&e.result==='OK'&&Array.isArray(e.from)&&Array.isArray(e.to)).map(e=>({...e,start:now,tribe:e.actor[0]}));
  }
  draw(ctx,now,{scale,colors,selected,observation,privateView=false}){
    this.effects=this.effects.filter(e=>now-e.start<1450);
    const visible=privateView?new Set((observation?.territory_live_view||observation?.local_view)?.cells.map(c=>c.position.join(','))||[]):null;
    let painted=0;
    for(const e of this.effects){
      if(privateView&&(e.actor!==selected||e.turn!==observation?.turn||!visible.has(e.from.join(','))||!visible.has(e.to.join(','))))continue;
      const elapsed=now-e.start,t=elapsed/1450,flight=this.reducedMotion?1:Math.min(1,elapsed/280);
      const [x,y]=e.from.map(v=>v+.5),[tx,ty]=e.to.map(v=>v+.5),color=colors[e.tribe]||'#ffda80';
      ctx.save();ctx.globalAlpha=Math.min(1,(1-t)*3);ctx.lineCap='round';
      if(flight<1){
        const head=[x+(tx-x)*flight,y+(ty-y)*flight],tail=Math.max(0,flight-.28);
        ctx.strokeStyle='#33221d';ctx.lineWidth=Math.max(.23,4/scale);ctx.beginPath();ctx.moveTo(x+(tx-x)*tail,y+(ty-y)*tail);ctx.lineTo(...head);ctx.stroke();
        ctx.strokeStyle=color;ctx.lineWidth=Math.max(.13,2.5/scale);ctx.stroke();ctx.fillStyle='#fff6c5';const size=Math.max(.18,3/scale);ctx.fillRect(head[0]-size/2,head[1]-size/2,size,size);
        ctx.strokeStyle=color;ctx.lineWidth=Math.max(.06,1/scale);ctx.strokeRect(x-.42,y-.42,.84,.84);
      }else{
        const impact=Math.min(1,(elapsed-280)/650),radius=this.reducedMotion ? .5 :.3+Math.max(0,impact)*.5;
        ctx.strokeStyle=e.killed?'#ffb16e':'#ffe1a0';ctx.lineWidth=Math.max(.09,1.8/scale);ctx.beginPath();ctx.arc(tx,ty,radius,0,Math.PI*2);ctx.stroke();
        if(!this.reducedMotion&&impact<1){ctx.fillStyle='#ffecb4';for(let i=0;i<8;i++){const angle=i*Math.PI/4,size=Math.max(.07,1.5/scale),r=.22+impact*.8;ctx.fillRect(tx+Math.cos(angle)*r-size/2,ty+Math.sin(angle)*r-size/2,size,size);}}
        if(e.killed){ctx.strokeStyle='#d95640';ctx.lineWidth=Math.max(.14,2.5/scale);ctx.beginPath();ctx.moveTo(tx-.26,ty-.26);ctx.lineTo(tx+.26,ty+.26);ctx.moveTo(tx+.26,ty-.26);ctx.lineTo(tx-.26,ty+.26);ctx.stroke();}
        ctx.font=`bold ${Math.max(.4,12/scale)}px monospace`;ctx.textAlign='center';ctx.lineWidth=Math.max(.1,3/scale);ctx.strokeStyle='#33251f';ctx.fillStyle=e.killed?'#ffb58d':'#fff3cd';
        const label=`−${e.damage} E${e.killed?' 击杀':''}`,labelY=ty-.6-(this.reducedMotion?0:t*.45);ctx.strokeText(label,tx,labelY);ctx.fillText(label,tx,labelY);
      }
      ctx.restore();painted++;
    }
    return {active:this.effects.length>0,painted};
  }
}
