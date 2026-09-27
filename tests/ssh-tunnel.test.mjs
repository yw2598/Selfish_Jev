import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { SshTunnel, managedPort, transportFailure } from '../lib/ssh-tunnel.mjs';

const destinations=Object.fromEntries([8100,8101,8102,8103,8108].map(p=>[p,{host:'jev.example.test',sshPort:2222,user:'tester',remotePort:p===8108?8100:p}]));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(options={}){
  let up=false;const children=[],calls=[];
  const tunnel=new SshTunnel(8100,{destination:destinations[8100],probe:async()=>up,launch:(command,args,opts)=>{
    calls.push({command,args,opts});const child=new EventEmitter();child.pid=100+children.length;child.stderr=new EventEmitter();child.unref=()=>{};child.kills=0;
    child.kill=()=>{child.kills++;up=false;child.emit('exit',0,'SIGTERM');return true;};children.push(child);up=true;return child;
  },watchIntervalMs:0,...options});
  return {tunnel,children,calls,setUp:value=>{up=value;}};
}
test('managed endpoints are restricted to the configured loopback ports',()=>{
  assert.equal(managedPort('http://127.0.0.1:8100',destinations),8100);assert.equal(managedPort('http://localhost:8103',destinations),8103);
  assert.equal(managedPort('http://127.0.0.1:8108',destinations),8108);
  for(const url of ['http://example.org:8100','http://127.0.0.1:8765','https://localhost:8100','invalid'])assert.equal(managedPort(url,destinations),null);
  assert.equal(transportFailure({cause:{code:'ECONNRESET'}}),true);assert.equal(transportFailure(new Error('HTTP 500')),false);
});

test('0.8B uses the new host and maps local 8108 to remote 8100',async()=>{
  let up=false,called;const tunnel=new SshTunnel(8108,{destination:destinations[8108],watchIntervalMs:0,probe:async()=>up,launch:(command,args)=>{called=args;up=true;const child=new EventEmitter();child.pid=900;child.unref=()=>{};child.kill=()=>child.emit('exit',0);return child;}});
  try{await tunnel.ensure();assert.ok(called.includes('2222'));assert.ok(called.includes('tester@jev.example.test'));assert.ok(called.includes('127.0.0.1:8108:127.0.0.1:8100'));assert.ok(!called.includes('root@216.243.220.227'));}finally{tunnel.close();}
});
test('concurrent requests share one SSH child with keepalives and hidden windows',async()=>{
  const f=fixture();try{await Promise.all(Array.from({length:8},()=>f.tunnel.ensure()));assert.equal(f.children.length,1);assert.equal(f.tunnel.status().owned,true);assert.equal(f.calls[0].opts.windowsHide,true);assert.ok(f.calls[0].args.includes('ExitOnForwardFailure=yes'));assert.ok(f.calls[0].args.includes('ServerAliveInterval=15'));}finally{f.tunnel.close();}
});
test('an existing external listener is reused and is never killed',async()=>{
  const f=fixture();f.setUp(true);await f.tunnel.ensure();await f.tunnel.recover({cause:{code:'ECONNRESET'}});f.tunnel.close();assert.equal(f.children.length,0);
});
test('watchdog recovers an exited owned child without a browser request',async()=>{
  const f=fixture({watchIntervalMs:10});try{await f.tunnel.ensure();f.children[0].stderr.emit('data',Buffer.from('connection dropped'));f.children[0].kill();
    const deadline=Date.now()+1000;while(f.children.length<2&&Date.now()<deadline)await delay(10);
    assert.equal(f.children.length,2);assert.equal(f.tunnel.status().state,'connected');assert.match(f.tunnel.status().lastExit.stderr,/connection dropped/);
  }finally{f.tunnel.close();}
});
test('concurrent transport failures share one reconnect, schema errors do not restart SSH',async()=>{
  const f=fixture();try{await f.tunnel.ensure();await f.tunnel.recover(new Error('invalid probabilities'));assert.equal(f.children.length,1);
    await f.tunnel.recover({cause:{code:'ECONNRESET'}});assert.equal(f.children[0].kills,0);assert.equal(f.children.length,1);
    f.setUp(false);
    await Promise.all(Array.from({length:4},()=>f.tunnel.recover({cause:{code:'ECONNRESET'}})));assert.equal(f.children.length,2);assert.equal(f.children[0].kills,1);
  }finally{f.tunnel.close();}
});
test('failure backoff does not keep extending when health checks arrive',async()=>{
  let now=1000,calls=0;const f=fixture({now:()=>now,launch:()=>{calls++;throw Error('SSH missing');}});
  try{await assert.rejects(()=>f.tunnel.ensure(),/SSH missing/);assert.equal(f.tunnel.retryAfter,3000);
    now=2000;await assert.rejects(()=>f.tunnel.ensure());assert.equal(f.tunnel.retryAfter,3000);assert.equal(calls,1);
    now=3001;await assert.rejects(()=>f.tunnel.ensure());assert.equal(calls,2);
  }finally{f.tunnel.close();}
});
test('closing while a probe is in flight never creates an orphan SSH child',async()=>{
  let release;const f=fixture({probe:()=>new Promise(resolve=>{release=resolve;})});const pending=f.tunnel.ensure();f.tunnel.close();release(false);
  await assert.rejects(()=>pending,/closed/);assert.equal(f.children.length,0);await assert.rejects(()=>f.tunnel.ensure(),/closed/);
});
