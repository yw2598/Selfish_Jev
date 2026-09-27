export class ReplayAudio{
  async ready(){
    if(!this.context){this.context=new AudioContext();this.master=this.context.createGain();this.master.gain.value=.32;this.master.connect(this.context.destination);this.destination=this.context.createMediaStreamDestination();this.master.connect(this.destination);this.voices=new Set();
      // A continuous silent source keeps MediaStream audio timestamps advancing
      // between cues and across consecutive exports (without it, muxing stalls).
      this.clock=this.context.createConstantSource();this.clock.offset.value=0;this.clock.connect(this.master);this.clock.start();
    }
    await this.context.resume();
  }
  set enabled(on){this.on=on;if(this.master)this.master.gain.setValueAtTime(on ? .32 : 0,this.context.currentTime);}
  tone(frequency,at,duration=.18,type='sine',level=.22){
    if(!this.context||!this.on)return;const ctx=this.context,osc=ctx.createOscillator(),gain=ctx.createGain();osc.type=type;osc.frequency.setValueAtTime(frequency,at);gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(level,at+.01);gain.gain.exponentialRampToValueAtTime(.0001,at+duration);osc.connect(gain);gain.connect(this.master);osc.start(at);osc.stop(at+duration+.01);this.voices.add(osc);osc.onended=()=>{this.voices.delete(osc);osc.disconnect();gain.disconnect();};
  }
  cue(frame){
    if(!this.context||!this.on)return;const at=this.context.currentTime;
    const special=frame.major.find(e=>e.kind==='extinction')||frame.major.find(e=>e.kind==='capture')||frame.major[0];
    if(special?.kind==='extinction'){[220,185,147,110].forEach((f,i)=>this.tone(f,at+i*.12,.3,'triangle',.3));return;}
    if(special?.kind==='capture'||special?.kind==='population'){[392,494,587,784].forEach((f,i)=>this.tone(f,at+i*.075,.2,'triangle'));return;}
    if(frame.combat.length){this.tone(85,at,.12,'sawtooth',.14);this.tone(55,at+.04,.15,'triangle',.2);}
    if(special?.kind==='mine'){this.tone(659,at,.22);this.tone(988,at+.09,.24);}
    else if(special){this.tone(330,at,.18);this.tone(440,at+.12,.18);}
    else if(frame.births.length)this.tone(880,at,.13,'sine',.09);
    else if(frame.movements.length)this.tone(160,at,.035,'triangle',.035);
  }
  stop(){for(const v of this.voices||[])try{v.stop();}catch{}this.voices?.clear();}
}
