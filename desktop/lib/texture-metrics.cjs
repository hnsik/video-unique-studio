'use strict';
const {metrics}=require('./studio3.cjs'),{png}=require('./textures.cjs');
function measure(a,b,w,h,threshold=2){
 const basic=metrics(a,b,w,h),histogram=Array(256).fill(0);let changed=0,luma=0,changedAmplitude=0;const count=w*h;
 for(let p=0;p<count;p++){const i=p*3,dr=Math.abs(a[i]-b[i]),dg=Math.abs(a[i+1]-b[i+1]),db=Math.abs(a[i+2]-b[i+2]),d=Math.max(dr,dg,db);histogram[d]++;if(d>threshold){changed++;changedAmplitude+=(dr+dg+db)/3;}luma+=Math.abs((a[i]-b[i])*0.2126+(a[i+1]-b[i+1])*0.7152+(a[i+2]-b[i+2])*0.0722);}
 const tw=Math.min(320,w),th=Math.max(1,Math.round(h*tw/w)),before=Buffer.alloc(tw*th*4),after=Buffer.alloc(tw*th*4),heat=Buffer.alloc(tw*th*4);
 for(let y=0;y<th;y++)for(let x=0;x<tw;x++){const i=(Math.min(h-1,Math.floor(y*h/th))*w+Math.floor(x*w/tw))*3,j=(y*tw+x)*4,d=Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]));for(let c=0;c<3;c++){before[j+c]=a[i+c];after[j+c]=b[i+c];}before[j+3]=after[j+3]=heat[j+3]=255;heat[j]=Math.min(255,d*8);heat[j+1]=Math.max(0,Math.min(255,(d-32)*4));heat[j+2]=d?Math.max(0,100-d*3):0;}
 return{...basic,lumaMAE:luma/count,changedPercent:changed/count*100,changedAmplitude:changed?changedAmplitude/changed:0,histogram,images:{before:png(before,tw,th).toString('base64'),after:png(after,tw,th).toString('base64'),heat:png(heat,tw,th).toString('base64')}};
}
function summarize(samples){const out={};for(const k of ['mae','lumaMAE','ssim','psnr','pHashDistance','changedPercent','changedAmplitude','maxDeviation']){const v=samples.map(s=>s[k]);out[k]={mean:v.reduce((a,b)=>a+b,0)/v.length,min:Math.min(...v),max:Math.max(...v)};}out.unchangedPHashPercent=samples.filter(s=>s.pHashDistance===0).length/samples.length*100;out.hashBits=64;out.histogram=Array.from({length:256},(_,i)=>samples.reduce((n,s)=>n+s.histogram[i],0));out.worstFrame=samples.reduce((a,b)=>b.ssim<a.ssim?b:a).index;return out;}
module.exports={measure,summarize};
