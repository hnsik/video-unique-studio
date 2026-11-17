'use strict';
class Pool{
 constructor(limit=2){this.limit=limit;this.active=0;this.queue=[];}
 async run(fn,signal){await new Promise((resolve,reject)=>{const entry={resolve:()=>{signal?.removeEventListener('abort',cancel);this.active++;resolve();}},cancel=()=>{const i=this.queue.indexOf(entry);if(i>=0)this.queue.splice(i,1);reject(Error('Диагностика отменена'));};if(signal?.aborted)return cancel();signal?.addEventListener('abort',cancel,{once:true});if(this.active<this.limit)entry.resolve();else this.queue.push(entry);});try{if(signal?.aborted)throw Error('Диагностика отменена');return await fn();}finally{this.active--;this.queue.shift()?.resolve();}}
}
function join(entry,signal){entry.users++;return new Promise((resolve,reject)=>{let done=false;const end=(fn,v)=>{if(done)return;done=true;signal?.removeEventListener('abort',abort);entry.users--;if(!entry.users&&!entry.done)entry.controller.abort();fn(v);},abort=()=>end(reject,Error('Диагностика отменена'));entry.promise.then(v=>end(resolve,v),e=>end(reject,e));if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});});}
module.exports={Pool,join};
