const names={A:'混沌战帮',B:'阿美瑞卡',C:'神圣泰拉',D:'蜂巢意志'};
const policies={NEUTRAL:'中立',AGGRESSIVE:'激进',CONSERVATIVE:'保守'};
const causes={ATTACK:'遭到攻击',SURVIVAL:'生存消耗',COST:'行动消耗',ACTION:'行动消耗'};
const num=n=>Number(n||0).toFixed(2),at=p=>Array.isArray(p)?`(${p.join(',')})`:'未记录坐标';
export function majorEvents(previous,current,events,seen=new Set(),config={}){
  const out=[],turn=current.turn,oldOwners=new Map(previous?.owners||[]),deaths=events.filter(e=>e.type==='DEATH');
  const add=(kind,title,detail,tribe,position,score,details=[],relatedTribes=[tribe])=>out.push({id:`${turn}:${kind}:${out.length}`,turn,kind,title,detail,tribe,relatedTribes:relatedTribes.filter(Boolean),position,score,details});
  const oldAgent=id=>previous?.agents?.find(a=>a.id===id),newAgent=id=>current.agents.find(a=>a.id===id);
  const byTribe=t=>current.tribes.find(a=>a.tribe===t),oldTribe=t=>previous?.tribes.find(a=>a.tribe===t);
  const economic=t=>{const a=oldTribe(t),b=byTribe(t);return a&&b?`公账 ${num(a.publicEnergy)} → ${num(b.publicEnergy)} E；矿点 ${a.controlledResources} → ${b.controlledResources}；领土 ${a.territory} → ${b.territory} 格（均为回合结算前后值）`:'';};
  const mines=new Set();
  for(const e of events){
    const tribe=e.actor?.[0]||e.tribe,name=names[tribe]||tribe;
    const index=e.position&&config.width?e.position[1]*config.width+e.position[0]:null;
    const resource=index!==null?current.resources?.[index]:null;
    if(['CAPTURE_REWARD','DISCOVERY_REWARD'].includes(e.type)||(e.type==='CLAIM'&&e.result==='OK'&&resource)){
      const key=`${e.actor}:${e.position}`;if(mines.has(key))continue;mines.add(key);
      const former=oldOwners.get(index),capture=e.type==='CAPTURE_REWARD'||(former&&former!==tribe),reward=events.find(v=>['CAPTURE_REWARD','DISCOVERY_REWARD'].includes(v.type)&&v.actor===e.actor&&String(v.position)===String(e.position));
      const title=`${name}${capture?'夺取敌矿':'占领无主矿'}`;
      const detail=`${e.actor} 于 ${at(e.position)} 占领${former?names[former]:'无主'}矿点${resource?`，产能 ${num(resource.production/100)} E/回合`:''}`;
      const details=[`矿权：${former?names[former]:'无主'} → ${name}。`,reward?`此次矿点奖励 ${num(reward.amount)} E；个人到账 ${num(reward.personal??reward.amount)} E，溢出公账 ${num(reward.public)} E。`:'本次未记录矿点奖励。',`占领后从下一回合开始收取该矿收入。`,economic(tribe)];
      add(capture?'capture':'mine',title,detail,tribe,e.position,capture?8:5,details,[tribe,former]);
    }
    if(e.type==='SUCCESSION')add('succession',`${name}国王更替`,`${e.previous} → ${e.actor}`,tribe,newAgent(e.actor)?.position,7,[`前任${deaths.some(d=>d.actor===e.previous)?'于本回合死亡':'已不再任职'}；新任国王位置 ${at(newAgent(e.actor)?.position)}。`,economic(tribe)]);
    if(e.type==='TRANSFER'&&e.result==='OK'&&typeof e.target==='string')add('cooperation',`${name}个体援助`,`${e.actor} → ${e.target}：实际转移 ${num(e.amount)} E`,tribe,newAgent(e.target)?.position,5,[`这是已结算的个体间转账，不是公账生活费或口头承诺。`,`接收者回合末余额 ${num(newAgent(e.target)?.energy)} E${newAgent(e.target)?'':'（本回合已死亡）'}。`],[tribe,e.target[0]]);
  }
  const fights=new Map();
  for(const e of events.filter(e=>e.type==='ATTACK'&&e.result==='OK'&&typeof e.target==='string'&&names[e.target[0]])){
    const tribe=e.actor[0],target=e.target[0],key=`${tribe}:${target}`;if(!fights.has(key))fights.set(key,[]);fights.get(key).push(e);
    if(tribe!==target&&!seen.has('first-battle')){seen.add('first-battle');add('battle','首次跨族交战',`${names[tribe]} → ${names[target]}：${e.actor} 攻击 ${e.target}`,tribe,e.to,8,[`${at(e.from)} → ${at(e.to)}；本次记录伤害 ${num(e.damage)} E。`],[tribe,target]);}
  }
  for(const [key,attacks]of fights){
    const [tribe,target]=key.split(':'),victims=deaths.filter(d=>d.cause==='ATTACK'&&attacks.some(a=>a.target===d.actor)),damage=attacks.reduce((n,a)=>n+(a.damage||0),0);
    add('combat',`${names[tribe]} → ${names[target]}交战`,`${attacks.length} 次命中，记录伤害 ${num(damage)} E；被攻击目标中 ${victims.length} 人阵亡`,tribe,attacks[0].to,victims.length?7:4,
      [...attacks.map(a=>`${a.actor} ${at(a.from)} → ${a.target} ${at(a.to)}：记录伤害 ${num(a.damage)} E。`),...(victims.length?[`阵亡目标：${victims.map(d=>d.actor).join('、')}。多人合击不在此重复归属击杀。`]:[]),'记录伤害是攻击事件数值，过量伤害不等于实际能量扣除。'],[tribe,target]);
  }
  for(const t of current.tribes){
    const old=oldTribe(t.tribe);if(!old)continue;const name=names[t.tribe],born=events.filter(e=>e.type==='BIRTH'&&e.actor[0]===t.tribe),lost=deaths.filter(e=>e.actor[0]===t.tribe);
    if(born.length)add('birth',`${name}新增 ${born.length} 名后代`,`人口 ${old.population} → ${t.population}；本回合出生 ${born.length}、死亡 ${lost.length}`,t.tribe,newAgent(born[0].actor)?.position,3,born.map(e=>`${e.parents.join('、')} → ${e.actor}，出生位置 ${at(newAgent(e.actor)?.position)}，回合末能量 ${num(newAgent(e.actor)?.energy)} E。`));
    if(lost.length)add('casualty',`${name}损失 ${lost.length} 人`,`人口 ${old.population} → ${t.population}；${lost.filter(e=>e.cause==='ATTACK').length} 人因攻击死亡`,t.tribe,oldAgent(lost[0].actor)?.position,lost.length>=3?7:5,lost.map(e=>`${e.actor}：${causes[e.cause]||e.cause}，回合开始位置 ${at(oldAgent(e.actor)?.position)}。`));
    if(old.population>0&&t.population===0)add('extinction',`${name}灭绝`,`最后 ${old.population} 名个体死亡；公账仍有 ${num(t.publicEnergy)} E`,t.tribe,oldAgent(lost[0]?.actor)?.position||previous.agents.find(a=>a.tribe===t.tribe)?.position,10,[...lost.map(e=>`${e.actor}：${causes[e.cause]||e.cause}。`),economic(t.tribe),'本族最后一个个体死亡即失败；残余公账、领土不会使种群复活。']);
    for(const n of [10,25,50])if(old.population<n&&t.population>=n&&!seen.has(`${t.tribe}:pop:${n}`)){seen.add(`${t.tribe}:pop:${n}`);add('population',`${name}达到 ${n} 人`,`人口 ${old.population} → ${t.population}；累计出生 ${t.births??0}、死亡 ${t.deaths??0}`,t.tribe,null,4,[economic(t.tribe)]);}
    if(old.nationalPolicy&&t.nationalPolicy&&old.nationalPolicy!==t.nationalPolicy){const decision=events.find(e=>e.type==='NATIONAL_POLICY'&&e.tribe===t.tribe);add('policy',`${name}改为${policies[t.nationalPolicy]}`,`${policies[old.nationalPolicy]} → ${policies[t.nationalPolicy]}；国王 ${decision?.actor||'未记录'}`,t.tribe,newAgent(decision?.actor)?.position,5,['国家倾向是当回合的策略偏好，实际行动仍按各个体的已结算记录显示。']);}
    if(old.publicEnergy>0&&t.publicEnergy===0&&t.population>0&&!seen.has(`${t.tribe}:bankrupt`)){seen.add(`${t.tribe}:bankrupt`);add('economy',`${name}公账耗尽`,`公账 ${num(old.publicEnergy)} → 0 E，尚有 ${t.population} 人存活`,t.tribe,null,6,[economic(t.tribe)]);}
    if(old.controlledResources>0&&t.controlledResources===0&&t.population>0)add('economy',`${name}失去全部矿点`,'下一回合不再获得矿产收入',t.tribe,null,9,[economic(t.tribe),'本回合开始时可能已经收取旧矿点的收入，故不能将失矿解释为当回合零收入。']);
    const demand=t.lastSubsistenceDemand||0,paid=t.lastSubsistencePaid||0,wasShort=(old.lastSubsistenceDemand||0)>(old.lastSubsistencePaid||0),short=demand>paid;
    if(short&&!wasShort)add('economy',`${name}生活费不足`,`应发 ${num(demand)} E，实发 ${num(paid)} E，缺口 ${num(demand-paid)} E`,t.tribe,null,7,[economic(t.tribe),'生活费按回合开始时存活的个体结算；回合末人口可能已变化。']);
    if(!short&&wasShort&&demand>0)add('economy',`${name}恢复足额生活费`,`应发与实发均为 ${num(paid)} E`,t.tribe,null,5,[economic(t.tribe)]);
    const blocked=events.filter(e=>e.type==='BIRTH_BLOCKED'&&e.actors?.some(id=>id[0]===t.tribe));
    if(blocked.length&&!seen.has(`${t.tribe}:birth-limit`)){seen.add(`${t.tribe}:birth-limit`);add('population',`${name}首次因人口上限繁殖受阻`,`${blocked.length} 次繁殖未执行；回合末 ${t.population} 人`,t.tribe,null,5,blocked.map(e=>`${e.actors.join('、')}：${e.reason}。`));}
  }
  return out;
}

export function roundSummary(previous,current,record={}){
  const events=record.events||[];
  const count=type=>events.filter(e=>e.type===type&&(e.result===undefined||e.result==='OK')).length;
  return {turn:current.turn,population:current.agents.length,births:count('BIRTH'),deaths:count('DEATH'),attacks:count('ATTACK'),claims:count('CLAIM'),moves:count('MOVE'),communications:count('COMMUNICATE'),gifts:events.filter(e=>e.type==='TRANSFER'&&e.result==='OK'&&e.target).length,crossGifts:events.filter(e=>e.type==='TRANSFER'&&e.result==='OK'&&typeof e.target==='string'&&e.actor[0]!==e.target[0]).length,crossAttacks:events.filter(e=>e.type==='ATTACK'&&e.result==='OK'&&typeof e.target==='string'&&e.actor[0]!==e.target[0]).length,
    routing:record.routing?{rule:record.routing.rule||0,kev:record.routing.kev||0,fallback:record.routing.fallback||0}:null,serviceFaults:record.serviceFaults||0,
    tribes:current.tribes.map(t=>{const old=previous?.tribes.find(v=>v.tribe===t.tribe);return {tribe:t.tribe,population:t.population,populationDelta:t.population-(old?.population??t.population),publicEnergy:t.publicEnergy,publicDelta:Number((t.publicEnergy-(old?.publicEnergy??t.publicEnergy)).toFixed(2)),mines:t.controlledResources,mineIncome:events.filter(e=>e.type==='MINE_INCOME'&&e.tribe===t.tribe).reduce((n,e)=>n+e.amount,0),welfare:t.lastSubsistencePaid||0,welfareDemand:t.lastSubsistenceDemand||0,policy:t.nationalPolicy||null};})};
}
