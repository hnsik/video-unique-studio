'use strict';
const {parentPort,workerData}=require('node:worker_threads');
try{parentPort.postMessage({result:require('./texture-metrics.cjs').measure(workerData.a,workerData.b,workerData.w,workerData.h,workerData.threshold)});}catch(e){parentPort.postMessage({error:e.message});}parentPort.close();
