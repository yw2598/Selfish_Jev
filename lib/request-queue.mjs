export class RequestQueue {
  constructor(limit){this.limit=limit;this.active=0;this.peak=0;this.waiting=[];}
  run(fn){return new Promise((resolve,reject)=>{this.waiting.push({fn,resolve,reject});this.drain();});}
  drain(){while(this.active<this.limit&&this.waiting.length){const job=this.waiting.shift();this.active++;this.peak=Math.max(this.peak,this.active);Promise.resolve().then(job.fn).then(job.resolve,job.reject).finally(()=>{this.active--;this.drain();});}}
  status(){return {limit:this.limit,active:this.active,queued:this.waiting.length,peak:this.peak};}
}

// Wait for all workers before propagating errors, so rollback cannot race workers.
export async function completeAll(tasks){const results=await Promise.allSettled(tasks);const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;return results.map(r=>r.value);}
