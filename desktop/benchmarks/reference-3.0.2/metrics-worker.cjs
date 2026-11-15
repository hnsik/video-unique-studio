'use strict';
const {parentPort,workerData}=require('node:worker_threads');
try { const {metrics}=require('./studio3.cjs');parentPort.postMessage({result:metrics(workerData.a,workerData.b,workerData.w,workerData.h)}); }
catch(e){parentPort.postMessage({error:e.message});}
parentPort.close();
