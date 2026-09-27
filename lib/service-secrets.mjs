import {existsSync,readFileSync} from 'node:fs';
import {writeFile,rename,mkdir} from 'node:fs/promises';
import path from 'node:path';
import './runtime-env.mjs';
import {teamIds,teamService,serviceEndpoint} from './service-config.mjs';

// Secrets live outside world configuration, reports, checkpoints and browser storage.
export class ServiceSecrets {
  constructor(file){this.file=file;this.values=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{};}
  key(slot,endpoint){
    const saved=this.values[slot];
    if(saved?.endpoint===endpoint)return saved.key; // Empty key explicitly disables inherited credentials.
    const prefix=slot==='language'?'LANGUAGE':'JEV',key=process.env[`${prefix}_API_KEY`],origin=process.env[`${prefix}_API_KEY_ORIGIN`]||(slot==='language'?'https://openrouter.ai':null);
    if(key&&origin&&endpoint&&new URL(endpoint).origin===new URL(origin).origin)return key;
    return '';
  }
  headers(slot,endpoint){const key=this.key(slot,endpoint);return key?{Authorization:`Bearer ${key}`}:{ };}
  flags(config){return Object.fromEntries([...teamIds,'language'].map(t=>[t,!!this.key(t,t==='language'?config.language.endpoint:teamService(config,t).endpoint)]));}
  prepare(input,config){
    if(!input||typeof input!=='object'||Array.isArray(input))throw Error('无效密钥设置');
    const next=structuredClone(this.values);
    for(const [slot,value]of Object.entries(input)){
      if(![...teamIds,'language'].includes(slot)||typeof value!=='string'||value.length>4096||/[\r\n]/.test(value))throw Error('无效服务密钥');
      const endpoint=slot==='language'?config.language.endpoint:teamService(config,slot).endpoint;
      serviceEndpoint(endpoint,{optional:slot==='language'});next[slot]={endpoint,key:value.trim()};
    }
    return next;
  }
  async save(next){await mkdir(path.dirname(this.file),{recursive:true});await writeFile(`${this.file}.tmp`,JSON.stringify(next),{mode:0o600});await rename(`${this.file}.tmp`,this.file);this.values=next;}
}
