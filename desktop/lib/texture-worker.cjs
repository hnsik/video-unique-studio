'use strict';
const {parentPort,workerData}=require('node:worker_threads');
const fs=require('node:fs'),{spawn}=require('node:child_process'),{once}=require('node:events');
const {pixels,png}=require('./textures.cjs');
(async()=>{const{p,file,ffmpeg,animated}=workerData;
 if(!animated)fs.writeFileSync(file,png(pixels(p,p.width,p.height),p.width,p.height));
 else{const fps=Math.max(1,Math.min(60,p.refresh||24)),duration=Math.max(1,Math.min(10,p.duration||4)),total=Math.round(fps*duration);const proc=spawn(ffmpeg,['-v','error','-y','-f','rawvideo','-pixel_format','rgba','-video_size',`${p.width}x${p.height}`,'-framerate',String(fps),'-i','pipe:0','-an','-c:v','qtrle','-pix_fmt','argb',file],{windowsHide:true,stdio:['pipe','ignore','pipe']});let log='';proc.stderr.on('data',b=>log=(log+b).slice(-4000));const done=new Promise((resolve,reject)=>{proc.on('error',reject);proc.on('close',code=>code===0?resolve():reject(Error(log||'Ошибка экспорта текстуры')));});proc.stdin.on('error',()=>{});try{for(let i=0;i<total;i++){if(!proc.stdin.write(pixels(p,p.width,p.height,i/fps)))await once(proc.stdin,'drain');}proc.stdin.end();await done;}finally{proc.kill();}}
 parentPort.postMessage({ok:true});})().catch(e=>parentPort.postMessage({error:e.message}));
