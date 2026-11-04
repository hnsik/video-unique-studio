import {compareFrames} from '../lib/metrics';
self.onmessage=(e:MessageEvent<{a:Uint8Array;b:Uint8Array;w:number;h:number}>)=>{try{const result=compareFrames(e.data.a,e.data.b,e.data.w,e.data.h);self.postMessage({result}, {transfer:[result.heat.buffer]});}catch(error){self.postMessage({error:String(error)});}};
