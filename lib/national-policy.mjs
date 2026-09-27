export const nationalPolicies={
  AGGRESSIVE:{label:'激进',instruction:'主动寻找、接近并攻击已知敌方单位，争夺敌方矿点；不攻击同族。根据当前可见信息选择目标，同时保留必要生存和行动能量。'},
  CONSERVATIVE:{label:'保守',instruction:'主动探索、接近并占领无主矿区；优先选择安全的无主矿和路线。遇到可见敌方单位时比较移动前后的最近敌方距离，倾向远离敌人、避开交战区域，不追击敌人；必要时自卫。保守不是停止扩张。'},
  NEUTRAL:{label:'中立',instruction:'主动探索、接近并占领无主矿区，同时有意识地守卫当前可见或记忆中需要核实的本族矿区，向受威胁的本族矿点靠拢，防御矿点周围的敌方单位；不主动攻击或夺取敌方矿点。中立不是原地等待，也不是停止占领无主矿。'}
};
export function policyCandidates(){return Object.entries(nationalPolicies).map(([stance,p])=>({path:[stance],action:{type:'SET_POLICY',stance},description:`${p.label}：${p.instruction} 本回合传达给本族全体单位，不消耗个人行动或能量。`}));}
export function policyRules(w,o){
  if(!w.config.nationalPolicyEnabled)return '';
  const policy=o.national_policy,description=nationalPolicies[policy?.stance||'NEUTRAL'];
  return `国家倾向由国王每回合在普通行动之前独立选择一次，不占普通行动、不收费，当回合立即作为全族共同指令。初始为中立，继任者继承当前倾向并可在下一回合重新选择。国家指令是真实引擎通知，不是可伪造的群体消息；不提供隐藏敌人或矿点坐标。国家倾向决定军事行为，四种个人/群体目标权重继续决定经济与生存取舍。\n当前国家倾向：${description.label}。${description.instruction}\n国王选择时比较激进（主动对敌单位作战、争夺敌矿）、保守（远离敌方单位）、中立（守卫己方矿区，不主动进攻敌矿）对本族存续的影响。矿区指矿点格及周围5×5范围；占领仍只改变脚下一个地块。敌方可占领我方矿点，收入从下一回合转给新主人，换手不重复发首占奖励，另按当前配置发放${w.config.enemyMineReward} E夺取敌方矿点奖励，优先进入占领者个人账户。`;
}
export function applyNationalPolicy(w,tribe,decision){
  if(!w.config.nationalPolicyEnabled)throw new Error('国家倾向未启用');
  const actor=w.rulers[tribe];if(!actor||!w.agents[actor]?.alive)throw new Error('没有存活国王');
  if(decision.action?.type!=='SET_POLICY'||!nationalPolicies[decision.action.stance])throw new Error('无效国家倾向');
  w.nationalPolicies[tribe]={stance:decision.action.stance,selected_by:actor,effective_turn:w.turn};
  w.events.push({turn:w.turn,type:'NATIONAL_POLICY',tribe,actor,stance:decision.action.stance});
}

export function tacticalContext(w,a,o){
  if(!w.config.nationalPolicyEnabled)return null;
  const cells=o.territory_live_view?.cells||o.local_view.cells;
  const mines=cells.filter(c=>c.resource&&c.owner_tribe===a.tribe).map(c=>w.index(...c.position));
  const enemies=o.local_view.observed_agents.filter(b=>b.tribe_id!==a.tribe);
  const known=new Map(cells.map(c=>[w.index(...c.position),c]));
  const enemyMine=p=>{const c=known.get(p);return !!c?.resource&&c.owner_tribe!==null&&c.owner_tribe!==a.tribe;};
  const nearMine=p=>mines.some(q=>Math.max(Math.abs(q%w.config.width-p%w.config.width),Math.abs(Math.floor(q/w.config.width)-Math.floor(p/w.config.width)))<=2);
  return {stance:o.national_policy?.stance||'NEUTRAL',enemyMine,nearMine,enemies,mines};
}
