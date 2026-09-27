export const teamIds=['A','B','C','D'];

export function serviceEndpoint(value,{optional=false}={}){
  if(typeof value!=='string')throw Error('服务端点须为字符串');
  const endpoint=value.trim().replace(/\/+$/,'');
  if(!endpoint&&optional)return '';
  let url;try{url=new URL(endpoint);}catch{throw Error('请输入完整的 http:// 或 https:// 服务端点');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('服务端点须为 HTTP(S) 地址，不能包含账号、密码、查询参数或片段');
  return endpoint;
}

export function teamService(config,team){
  const override=config.kev.teams?.[team];
  return {...config.kev,endpoint:override?.endpoint||config.kev.endpoint,model:override?.model||config.kev.model};
}

export function validateServices(config){
  for(const name of ['kev','language']){
    const s=config[name],allowed=['endpoint','model','concurrency','timeoutMs',...(name==='kev'?['teams']:[])];
    if(Object.keys(s).some(k=>!allowed.includes(k)))throw Error('服务配置包含未知字段；API 密钥请在服务端点面板单独设置');
    s.endpoint=serviceEndpoint(s.endpoint,{optional:name==='language'});
    if(typeof s.model!=='string'||(s.endpoint&&!s.model.trim()))throw Error('请填写模型名称');
    s.model=s.model.trim();
  }
  config.kev.teams??=Object.fromEntries(teamIds.map(t=>[t,{endpoint:'',model:''}]));
  const teams=config.kev.teams;
  if(!teams||Array.isArray(teams)||Object.keys(teams).some(t=>!teamIds.includes(t)))throw Error('Jev 队伍仅支持 A、B、C、D');
  for(const t of teamIds){
    const s=teams[t]??={endpoint:'',model:''};
    if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).some(k=>!['endpoint','model'].includes(k)))throw Error('队伍配置仅支持端点和模型名称');
    s.endpoint=serviceEndpoint(s.endpoint??'',{optional:true});
    if(typeof(s.model??'')!=='string')throw Error('模型名称须为字符串');
    s.model=(s.model??'').trim();
  }
}
