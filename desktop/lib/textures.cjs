'use strict';
const zlib=require('node:zlib');
const fs=require('node:fs/promises');
const path=require('node:path');
const modes=['normal','multiply','screen','overlay','softlight','hardlight','addition','difference'];
function random(seed){let x=seed>>>0||1;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
const clamp=(x,a=0,b=255)=>Math.min(b,Math.max(a,x));
const kinds=['Gaussian Noise','Monochrome Noise','RGB Noise','Film Grain','Perlin Noise','Fractal Noise','Gradient','Light Leak','Geometric Pattern','Animated Noise'];
const groups=[['micro',30,['Gaussian Noise','Monochrome Noise','RGB Noise','Film Grain','Perlin Noise','Fractal Noise','Animated Noise']],['film',20,['Film Dust','Film Scratches','VHS Noise','Analog Noise','Vintage Film','Old Camera','Dust Particles','Film Flicker','Scan Lines','Film Damage']],['light',20,['Light Leak','Lens Flare','Soft Glow','Warm Light','Cold Light','Light Streaks','Neon Glow','Cinematic Gradient','Reflections','Soft Highlights']],['geometric',20,['Dots','Lines','Grid','Waves','Diagonal','Microgeometry','Shapes','Abstract Pattern','Soft Stripes','Geometric Gradient']],['backgrounds',20,['Blurred Background','Dark Gradient','Light Gradient','Color Transition','Abstract Background','Animated Background','Cinematic Background','Vertical Background','Horizontal Background','Soft Surface']]];
const catalog=groups.flatMap(([category,count,types],g)=>Array.from({length:count},(_,i)=>({id:`vus-${category}-${String(i+1).padStart(2,'0')}`,name:`${types[i%types.length]} ${Math.floor(i/types.length)+1}`,category,kind:types[i%types.length],seed:1009+g*4093+i*71,intensity:0.15+(i%6)*0.13,density:0.1+(i%5)*0.17,grain:1+(i%4)*3,color:['#b7c9e2','#ffa769','#79bafc','#ad84eb','#f0da99'][i%5],contrast:1,brightness:0,alpha:1,speed:0.2+(i%4)*0.2,direction:i*37,refresh:24,dynamic:/Animated|Flicker|Dynamic/.test(types[i%types.length]),loop:true,duration:4,width:1080,height:1920,recommendedOpacity:category==='backgrounds'?100:category==='micro'?5:15,modes})));
function lattice(x,y,seed){let n=Math.imul(x,374761393)+Math.imul(y,668265263)+seed;n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967296;}
function perlin(x,y,seed){const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;const smooth=t=>t*t*t*(t*(t*6-15)+10),dot=(a,b)=>{const angle=lattice(a,b,seed)*Math.PI*2;return Math.cos(angle)*(x-a)+Math.sin(angle)*(y-b);};const a=dot(ix,iy)*(1-smooth(fx))+dot(ix+1,iy)*smooth(fx),b=dot(ix,iy+1)*(1-smooth(fx))+dot(ix+1,iy+1)*smooth(fx);return 0.5+(a*(1-smooth(fy))+b*smooth(fy))*0.7;}
function pixels(p,w,h,t=0){
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<2||h<2||w*h>10000000)throw Error('Разрешение текстуры: от 2×2 до 10 млн пикселей');
 const out=Buffer.alloc(w*h*4),col=(p.color||'#aaccff').match(/[a-f0-9]{2}/gi)?.map(x=>parseInt(x,16))||[170,204,255],seed=p.seed>>>0;
 const kind=p.kind||'Gaussian Noise',grain=Math.max(1,p.grain||1),power=p.intensity??0.5,density=p.density??0.4;
 const flag0=/Gaussian/.test(kind),flag1=/Perlin|Fractal|Surface|Blurred|Abstract Background|Animated Background/.test(kind),flag2=/Fractal/.test(kind),flag3=/Grain|Noise|Analog|VHS|Camera|Film Flicker|Vintage/.test(kind),flag4=/VHS|Analog|Camera/.test(kind),flag5=/Flicker/.test(kind),flag6=/Dust|Damage/.test(kind),flag7=/Scratches/.test(kind),flag8=/Light|Flare|Glow|Reflection|Highlight|Streak|Leak/.test(kind),flag9=/Gradient/.test(kind),flag10=/Streak/.test(kind),flag11=/Flare/.test(kind),flag12=/Dots|Shapes|Microgeometry/.test(kind),flag13=/Grid/.test(kind),flag14=/Lines|Scan|Stripes|Diagonal|Pattern|Waves|geometry/.test(kind),flag15=/Diagonal/.test(kind),flag16=/RGB/.test(kind),flag17=/Noise|Grain/.test(kind),flag18=/Gradient|Background|Transition|Light|Glow|Flare|Reflection|Highlight|Leak|Surface/.test(kind);
 const gradients=new Map(),samplePerlin=(x,y,seed)=>{const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,smooth=t=>t*t*t*(t*(t*6-15)+10),dot=(a,b)=>{const key=a+','+b+','+seed;let g=gradients.get(key);if(!g){const needsCell=!/Gaussian|RGB/.test(kind)&&/Grain|Noise|Analog|VHS|Camera|Film Flicker|Vintage|Dust|Damage/.test(kind);
 const angle=lattice(a,b,seed)*Math.PI*2;g=[Math.cos(angle),Math.sin(angle)];gradients.set(key,g);}return g[0]*(x-a)+g[1]*(y-b);};const a=dot(ix,iy)*(1-smooth(fx))+dot(ix+1,iy)*smooth(fx),b=dot(ix,iy+1)*(1-smooth(fx))+dot(ix+1,iy+1)*smooth(fx);return 0.5+(a*(1-smooth(fy))+b*smooth(fy))*0.7;};
 const needsCell=!/Gaussian|RGB/.test(kind)&&/Grain|Noise|Analog|VHS|Camera|Film Flicker|Vintage|Dust|Damage/.test(kind);
 const angle=(p.direction||0)*Math.PI/180,theta=2*Math.PI*t/(p.duration||4),speed=p.speed||1;
 const px=p.loop===false?t*speed:Math.sin(theta)*speed,py=p.loop===false?0:(1-Math.cos(theta))*speed;
 const dx=(px*Math.cos(angle)-py*Math.sin(angle))*0.1,dy=(px*Math.sin(angle)+py*Math.cos(angle))*0.1;
 const noise=(x,y,channel=0,gaussian=false)=>{const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
   const at=(a,b)=>{const u=Math.max(1e-9,lattice(a,b,seed+channel*193)),v=lattice(a,b,seed+channel*193+127);return gaussian?0.5+Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)*0.17:u;};
   const a=at(ix,iy)*(1-fx)+at(ix+1,iy)*fx,b=at(ix,iy+1)*(1-fx)+at(ix+1,iy+1)*fx;return a*(1-fy)+b*fy;};
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const u=x/w+dx,v=y/h+dy,nx=(x+dx*w)/grain,ny=(y+dy*h)/grain,cell=needsCell?noise(nx,ny):0;let n=0.5,a=p.alpha??1;
  if(flag0)n=noise(nx,ny,0,true);
  else if(flag1){n=samplePerlin(u*24/grain,v*24/grain,seed);if(flag2)n=(n+0.5*samplePerlin(u*48/grain,v*48/grain,seed+1)+0.25*samplePerlin(u*96/grain,v*96/grain,seed+2))/1.75;}
  else if(flag3){n=cell;if(flag4)n=n*0.7+(0.5+0.5*Math.sin(ny*2))*0.3;if(flag5)n*=0.8+0.2*Math.cos(theta);}
  else if(flag6){n=cell>1-density*0.2?1:0;a*=n;}
  else if(flag7){n=noise(nx,0)>1-density*0.12?1:0;a*=n;}
  else if(flag8&&!flag9){n=Math.exp(-((u-0.15-(seed%5)/10)**2+(v-0.4)**2)*(3+grain));if(flag10)n=Math.exp(-((u-v-0.15)**2)*180/grain);if(flag11)n+=Math.exp(-((u-0.7)**2+(v-0.75)**2)*100);}
  else if(flag12){n=((nx%8-4)**2+(ny%8-4)**2)<Math.max(0.1,density*16)?1:0;a*=n;}
  else if(flag13){n=((nx%8+8)%8)<density*3||((ny%8+8)%8)<density*3?1:0;a*=n;}
  else if(flag14){n=0.5+Math.sin((flag15?nx+ny:ny)+Math.sin(u*8)*2)*0.5;}
  else n=clamp((u*Math.cos(angle)+v*Math.sin(angle)+1)/2,0,1);
  for(let c=0;c<3;c++){
   let value=flag16?noise(nx,ny,c+1):n;
   if(flag17)value=0.5+(value-0.5)*Math.sqrt(Math.max(0,density));
   value=clamp((value-0.5)*(p.contrast??1)+0.5+(p.brightness??0),0,1);
   if(flag18)value*=col[c]/255*power;
   else value=0.5+(value-0.5)*power;
   value=clamp(value*(0.91+(seed%89)/1000),0,1);out[(y*w+x)*4+c]=Math.round(value*255);
  }
  out[(y*w+x)*4+3]=Math.round(clamp(a,0,1)*255);
 }return out;
}

const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(buf){let n=0xffffffff;for(const b of buf)n=table[(n^b)&255]^(n>>>8);return(n^0xffffffff)>>>0;}
function chunk(type,data){const head=Buffer.from(type),len=Buffer.alloc(4),tail=Buffer.alloc(4);len.writeUInt32BE(data.length);tail.writeUInt32BE(crc(Buffer.concat([head,data])));return Buffer.concat([len,head,data,tail]);}
function png(data,w,h){const hdr=Buffer.alloc(13);hdr.writeUInt32BE(w);hdr.writeUInt32BE(h,4);hdr[8]=8;hdr[9]=6;const rows=Buffer.alloc(h*(w*4+1));for(let y=0;y<h;y++)data.copy(rows,y*(w*4+1)+1,y*w*4,(y+1)*w*4);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',hdr),chunk('IDAT',zlib.deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);}
async function buildLibrary(root){await fs.mkdir(root,{recursive:true});for(const p of catalog){const dir=path.join(root,p.category);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,p.id+'.png'),png(pixels(p,270,480),270,480));await fs.writeFile(path.join(dir,p.id+'.json'),JSON.stringify(p,null,2));}await fs.writeFile(path.join(root,'catalog.json'),JSON.stringify(catalog,null,2));}
module.exports={random,clamp,kinds,catalog,pixels,png,buildLibrary,modes,perlin};
if(require.main===module)buildLibrary(process.argv[2]||path.join(__dirname,'../assets/textures')).catch(e=>{console.error(e);process.exitCode=1;});
