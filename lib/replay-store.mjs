import {readdir,stat,readFile} from 'node:fs/promises';
import {Worker} from 'node:worker_threads';
import path from 'node:path';
export class ReplayStore{
  constructor(directory){this.directory=directory;this.jobs=new Map();this.active=null;}
  id(id){if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw Error('无效回放编号');return id;}
  file(id){return path.join(this.directory,`${this.id(id)}.jsonl`);}
  output(id){return path.join(this.directory,`${this.id(id)}-cinema.json`);}
  async list(current){const entries=await readdir(this.directory);const list=await Promise.all(entries.filter(f=>f.endsWith('.jsonl')&&/^[a-zA-Z0-9_-]+\.jsonl$/.test(f)).map(async f=>{const s=await stat(path.join(this.directory,f)),id=f.slice(0,-6);return {id,modifiedAt:s.mtime.toISOString(),bytes:s.size,current:id===current,status:this.jobs.get(id)?.state||'available'};}));return list.sort((a,b)=>Number(b.current)-Number(a.current)||b.modifiedAt.localeCompare(a.modifiedAt));}
  async start(id){
    id=this.id(id);const source=await stat(this.file(id)),job=this.jobs.get(id);
    if(job?.state==='building')return job;
    try{const saved=JSON.parse(await readFile(this.output(id),'utf8'));if(saved.version===1&&saved.source.size===source.size&&saved.source.mtimeMs===source.mtimeMs){const done={state:'ready',turn:saved.verifiedTurns,source:saved.source,warnings:saved.warnings};this.jobs.set(id,done);return done;}}catch{}
    if(this.active)throw Error('另一个回放正在准备，请稍后重试');
    const state={state:'building',turn:0};this.jobs.set(id,state);this.active=id;
    const worker=new Worker(new URL('./replay-worker.mjs',import.meta.url),{workerData:{file:this.file(id),output:this.output(id),episode:id}});
    worker.on('message',message=>{Object.assign(state,message);});worker.on('error',e=>{Object.assign(state,{state:'error',error:e.message});this.active=null;});worker.on('exit',code=>{if(state.state==='building')Object.assign(state,{state:'error',error:`回放任务意外结束（${code}）`});if(this.active===id)this.active=null;});return state;
  }
  status(id){return this.jobs.get(this.id(id))||{state:'idle'};}
  async data(id){if(this.status(id).state!=='ready')throw Error('回放尚未准备好');return readFile(this.output(id),'utf8');}
}
