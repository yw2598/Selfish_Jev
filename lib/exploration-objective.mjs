// Prompt preference only: legal candidates and Kev sampling remain unchanged.
export function explorationObjective(config){
  if(config.explorationTendency==='none')return '';
  const degree=config.explorationTendency==='strong'?'积极':'温和';
  const layout=config.neutralMineLayout==='vision5'&&config.resourceCount===null?(config.resourceDensity<1?`自动矿点数量按原布局的${config.resourceDensity*100}%生成，保留出生矿，不保证5×5视野内有矿；不能据此断言未知坐标存在未占矿。`:'新地图生成时，初始领地以外任意位置的5×5视野至少覆盖一座初始中立矿；这是初始分布规则，矿点后来可能已被占领或编辑，不能据此断言未知坐标存在未占矿。'):'';
  const reward=config.miningMode==='automatic'?`首次占领未发奖矿点可获得${config.discoveryReward} E，之后矿产持续进入本族公账；即使偏重个人收益，也要比较首占回报、移动成本与种群存续。`:'';
  return `探索倾向（${degree}）：在满足生存和必要补给的前提下，${degree}偏向走出已熟悉领地，寻找和占领矿点。${layout}${reward}优先考虑当前可见的中立矿，其次考虑记忆中仍需核实的矿点和未知区域；目标不在脚下时先选择可行的移动，到达后再考虑CLAIM，占领只作用于脚下格。没有收益或新信息时，减少原地等待、往返走老路和占领无矿空地。结合你现有观察、记忆、能量及授权评估路程和后续生存消耗；低能量时先考虑可行补给，避免为探索耗尽能量。统治者也应考虑用公账授权支持本族探索与延续。探索是决策偏好，仍须按本族目标权重在探索、补给、繁殖和救助之间取舍，不提供全图矿点坐标，也不要求固定动作。`;
}
