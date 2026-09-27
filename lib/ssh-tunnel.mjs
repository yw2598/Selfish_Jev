import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import { readFileSync,existsSync } from 'node:fs';

const destinationFile=new URL('../kev-deploy/ssh-connections.json',import.meta.url);
const destinations=existsSync(destinationFile)?JSON.parse(readFileSync(destinationFile,'utf8')):{};
const tunnels = new Map();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function transportFailure(error) {
  return ['ECONNREFUSED','ECONNRESET','EPIPE','UND_ERR_SOCKET','ENOTFOUND','EHOSTUNREACH','ENETUNREACH'].includes(error?.cause?.code || error?.code);
}
export function managedPort(endpoint,connections=destinations) {
  try {
    const url = new URL(endpoint), port = Number(url.port);
    return url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname) && Object.hasOwn(connections,port) ? port : null;
  } catch { return null; }
}
function listening(port) {
  return new Promise(resolve => {
    const socket = createConnection({host:'127.0.0.1',port});
    const done = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(600, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

// Own only the SSH children created here. Existing listeners and remote services
// are never stopped. Concurrent model requests share one repair operation.
export class SshTunnel {
  constructor(port, {probe=listening, launch=spawn, delay=sleep, readyTimeoutMs=35000, watchIntervalMs=5000, now=Date.now,destination=destinations[port]}={}) {
    Object.assign(this, {port,probe,launch,delay,readyTimeoutMs,watchIntervalMs,now});
    this.destination=destination;
    this.child=null;this.pending=null;this.timer=null;this.closed=false;this.starts=0;
    this.state='unchecked';this.lastError=null;this.lastExit=null;this.failures=0;this.retryAfter=0;
  }
  status() { return {state:this.state,port:this.port,destination:this.destination,pid:this.child?.pid??null,owned:!!this.child,starts:this.starts,lastError:this.lastError,lastExit:this.lastExit}; }
  ensure() { return this.repair(false); }
  // A refused/reset remote HTTP connection does not prove SSH is broken. Keep a
  // listening tunnel alive so one failed request cannot disconnect its siblings.
  recover(error) { return transportFailure(error) ? this.ensure() : Promise.resolve(); }
  repair(force) {
    if(this.closed)return Promise.reject(new Error('SSH tunnel manager is closed'));
    if(this.pending)return this.pending;
    if(this.now()<this.retryAfter)return Promise.reject(new Error(this.lastError||'SSH reconnect backoff'));
    // Lazy monitoring avoids SSH side effects merely from constructing a world.
    if(!this.timer && this.watchIntervalMs>0){
      this.timer=setInterval(()=>{void this.ensure().catch(()=>{});},this.watchIntervalMs);this.timer.unref();
    }
    this.pending=this.connect(force).then(()=>{this.failures=0;this.retryAfter=0;this.state='connected';this.lastError=null;}).catch(error=>{
      this.state='offline';this.lastError=error.message;this.retryAfter=this.now()+Math.min(30000,2000*2**Math.min(this.failures++,4));throw error;
    }).finally(()=>{this.pending=null;});
    return this.pending;
  }
  async stopOwned() {
    const child=this.child;if(!child)return;
    child.kill();
    const deadline=this.now()+1000;
    while(this.child===child && this.now()<deadline)await this.delay(50);
    if(this.child===child)throw new Error(`SSH child ${child.pid} has not exited`);
  }
  async connect(force) {
    if(force)await this.stopOwned();
    if(await this.probe(this.port))return;
    if(this.closed)throw new Error('SSH tunnel manager is closed');
    await this.stopOwned();
    if(this.closed)throw new Error('SSH tunnel manager is closed');
    this.state='connecting';
    const destination=this.destination;
    if(!destination)throw new Error(`No SSH destination configured for port ${this.port}`);
    const args=['-N','-T','-o','BatchMode=yes','-o','ConnectTimeout=30','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2','-p',String(destination.sshPort),'-i',path.join(homedir(),'.ssh','id_ed25519'),'-L',`127.0.0.1:${this.port}:127.0.0.1:${destination.remotePort}`,`${destination.user}@${destination.host}`];
    const child=this.launch('ssh',args,{windowsHide:true,stdio:['ignore','ignore','pipe']});
    this.child=child;this.starts++;let stderr='',failure=null;
    child.stderr?.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-1600);});
    child.once('error',error=>{failure=error;if(this.child===child)this.child=null;});
    child.once('exit',(code,signal)=>{
      this.lastExit={at:this.now(),code,signal,stderr:stderr.trim()};
      failure ||= new Error(`SSH exited (${code??signal}): ${stderr.trim()||'connection closed'}`);
      if(this.child===child){this.child=null;this.state='offline';this.lastError=failure.message;}
      if(!this.closed)console.warn(`[Kev SSH ${this.port}] ${failure.message}`);
    });
    child.unref();child.stderr?.unref?.();
    const deadline=this.now()+this.readyTimeoutMs;
    while(this.now()<deadline && !this.closed){
      if(failure)throw failure;
      if(await this.probe(this.port)){if(failure)throw failure;return;}
      await this.delay(150);
    }
    await this.stopOwned();
    throw new Error(`SSH 127.0.0.1:${this.port} did not become ready: ${stderr.trim()||'timeout'}`);
  }
  close() { this.closed=true;clearInterval(this.timer);this.timer=null;this.child?.kill(); }
}
export function tunnelFor(endpoint) {
  const port=managedPort(endpoint);
  if(!port || process.env.KEV_MANAGED_SSH==='0')return null;
  if(!tunnels.has(port))tunnels.set(port,new SshTunnel(port));
  return tunnels.get(port);
}
export function closeTunnels(){for(const tunnel of tunnels.values())tunnel.close();}
process.once('exit',closeTunnels);
