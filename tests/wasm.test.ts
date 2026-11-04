import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {defaults,timeline,buildArgs,geometry,type Probe} from '../src/lib/processing';
import {cleanMp4,fastStart} from '../src/lib/mp4';
import {compareFrames} from '../src/lib/metrics';
const exec=promisify(execFile),require=createRequire(import.meta.url);
test('actual pinned FFmpeg WASM core: probe, video/audio encode, aligned RGB extraction, metadata and decoding',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'vus-wasm-'));const previous=Object.getOwnPropertyDescriptor(globalThis,'self');Object.defineProperty(globalThis,'self',{value:{location:{href:'file:///ffmpeg-core.js'}},configurable:true});
 try{
  const factory=require('../node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js');const core=await factory({wasmBinary:await readFile('node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm')});const messages:string[]=[];core.setLogger(({message}:{message:string})=>{messages.push(message);});
  const run=(args:string[])=>{core.exec(...args);const code=core.ret;core.reset();assert.equal(code,0,messages.slice(-8).join('\n'));};
  const probe=(name:string):Probe=>{core.ffprobe('-v','error','-count_frames','-show_format','-show_streams','-of','json',name,'-o','probe.json');const code=core.ret;core.reset();assert([0,-1].includes(code));return JSON.parse(core.FS.readFile('probe.json',{encoding:'utf8'}));};
  const input=path.join(dir,'in.mp4');await exec('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=s=96x64:r=30','-f','lavfi','-i','sine=frequency=600','-t','1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-y',input]);core.FS.writeFile('input',new Uint8Array(await readFile(input)));const p=probe('input');assert.equal(p.streams[0].codec_name,'h264');
  const s={...defaults,durationVariation:true,frameVariation:true,zoom:1.04,brightness:.02,noise:1,hue:2,audioNormalize:true,fadeAudio:true},t=timeline(s,1,4);run(buildArgs('input','out.mp4',s,96,64,true,t,p));const cleaned=new Uint8Array(core.FS.readFile('out.mp4'));cleanMp4(cleaned);assert(fastStart(cleaned));core.FS.writeFile('final.mp4',cleaned);const out=probe('final.mp4');assert.equal(Number(out.streams[0].nb_read_frames),t.frames);assert.equal(out.streams[1].codec_name,'aac');assert.equal(out.streams[1].profile,'LC');assert.equal(out.streams[0].tags?.encoder,undefined);assert.equal(out.format.tags?.encoder,undefined);
  run(['-v','error','-xerror','-i','final.mp4','-map','0:v','-map','0:a?','-f','null','-']);
  const select='select=eq(n\\,3)+eq(n\\,8)+eq(n\\,12)';run(['-i','input','-vf',[`setpts=(PTS-STARTPTS)/${s.speed}`,...geometry(s,96,64),'fps=30',select,'scale=48:32:flags=area'].join(','),'-vsync','0','-frames:v','3','-pix_fmt','rgb24','-f','rawvideo','-y','a.rgb']);run(['-i','final.mp4','-vf',select+',scale=48:32:flags=area','-vsync','0','-frames:v','3','-pix_fmt','rgb24','-f','rawvideo','-y','b.rgb']);const a=new Uint8Array(core.FS.readFile('a.rgb')),b=new Uint8Array(core.FS.readFile('b.rgb'));assert.equal(a.length,48*32*3*3);assert.equal(b.length,a.length);const m=compareFrames(a.slice(0,4608),b.slice(0,4608),48,32);assert(m.mae>0&&m.mae<40);assert(m.ssim>.6);
  await writeFile(path.join(dir,'wasm.mp4'),cleaned);await exec('ffmpeg',['-v','error','-xerror','-i',path.join(dir,'wasm.mp4'),'-f','null','-']);
 }finally{if(previous)Object.defineProperty(globalThis,'self',previous);else Reflect.deleteProperty(globalThis,'self');await rm(dir,{recursive:true,force:true});}
});

test('worker handoff keeps final result bytes available for MP4 inspection and download',async()=>{
 const {writeRetained}=await import('../src/lib/pipeline');
 const original=new Uint8Array([0,0,0,8,102,114,101,101]);
 const worker={writeFile:async(_name:string,data:unknown)=>{const bytes=data as Uint8Array;structuredClone(bytes,{transfer:[bytes.buffer]});return true;}};
 await writeRetained(worker as never,'final.mp4',original);
 assert.equal(original.length,8);assert.equal(new DataView(original.buffer).getUint32(0),8);
});
