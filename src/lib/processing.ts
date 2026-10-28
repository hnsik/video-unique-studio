export type Settings={speed:number;brightness:number;contrast:number;saturation:number;zoom:number;volume:number;fps:number;resolution:'original'|'720'|'1080';metadata:'strip'|'keep';title:string;overlay:string;overlaySize:number;overlayX:number;overlayY:number;subtitles:string;seed:number;auto:boolean;variations:number;speedVariation:number;colorVariation:number;zoomVariation:number;mute:boolean;format:'mp4'|'webm';flip:boolean;hue:number;noise:number;vignette:boolean;strength:'light'|'medium'|'strong'};
export const defaults:Settings={speed:1,brightness:0,contrast:1,saturation:1,zoom:1,volume:1,fps:30,resolution:'original',metadata:'strip',title:'',overlay:'',overlaySize:38,overlayX:50,overlayY:85,subtitles:'',seed:12345,auto:false,variations:1,speedVariation:.04,colorVariation:.04,zoomVariation:.025,mute:false,format:'mp4',flip:false,hue:0,noise:0,vignette:false,strength:'medium'};
export function randomFor(s:Settings,index:number):Settings{
 if(!s.auto)return {...s};
 let x=(s.seed+index*2654435761)>>>0;
 const rnd=()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296};
 const centered=()=>rnd()*2-1;
 const factor=s.strength==='light'?.5:s.strength==='strong'?1.6:1;
 return {...s,
  speed:clamp(s.speed+centered()*s.speedVariation*factor,.85,1.25),
  brightness:clamp(s.brightness+centered()*s.colorVariation*factor/3,-.15,.15),
  contrast:clamp(s.contrast+centered()*s.colorVariation*factor,.85,1.15),
  saturation:clamp(s.saturation+centered()*s.colorVariation*factor,.8,1.2),
  zoom:clamp(s.zoom+rnd()*s.zoomVariation*factor,1,1.12),
  hue:clamp(s.hue+centered()*8*factor,-25,25),
  noise:clamp(s.noise+rnd()*3*factor,0,12),
  flip:s.flip || (s.strength==='strong' && rnd()>.75),
  vignette:s.vignette || (s.strength==='strong' && rnd()>.75)
 };
}
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
export function parseSrt(text:string){return text.replace(/\r/g,'').split(/\n\s*\n/).map(block=>{const lines=block.split('\n');const time=lines.findIndex(l=>l.includes('-->'));if(time<0)return null;const m=lines[time].match(/(\d\d):(\d\d):(\d\d)[,.](\d+)\s*-->\s*(\d\d):(\d\d):(\d\d)[,.](\d+)/);if(!m)return null;const sec=(a:string,b:string,c:string,d:string)=>+a*3600+ +b*60+ +c+ +d/1000;return {start:sec(m[1],m[2],m[3],m[4]),end:sec(m[5],m[6],m[7],m[8]),text:lines.slice(time+1).join(' ').trim()}}).filter((v):v is {start:number;end:number;text:string}=>!!v)}
export function buildFilters(s:Settings,w:number,h:number){const filters:string[]=[];
if(s.speed!==1)filters.push(`setpts=${(1/s.speed).toFixed(7)}*PTS`);
if(s.brightness!==0||s.contrast!==1||s.saturation!==1)filters.push(`eq=brightness=${s.brightness.toFixed(4)}:contrast=${s.contrast.toFixed(4)}:saturation=${s.saturation.toFixed(4)}`);
if(s.flip)filters.push('hflip');
if(s.hue)filters.push(`hue=h=${s.hue.toFixed(2)}`);
if(s.noise>0)filters.push(`noise=alls=${s.noise.toFixed(2)}:allf=t`);
if(s.vignette)filters.push('vignette=PI/5');
if(s.zoom>1){const z=s.zoom;filters.push(`crop=iw/${z.toFixed(5)}:ih/${z.toFixed(5)}:(iw-out_w)/2:(ih-out_h)/2`)}
if(s.resolution!=='original'){const target=s.resolution==='720'?720:1080;filters.push(`scale=${target}:-2`)}else if(s.zoom>1){filters.push(`scale=${Math.floor(w/2)*2}:${Math.floor(h/2)*2}`)}
if(s.fps>0)filters.push(`fps=${s.fps}`);
filters.push('pad=ceil(iw/2)*2:ceil(ih/2)*2');filters.push('setsar=1');return filters.join(',')}
export function buildArgs(input:string,output:string,s:Settings,w:number,h:number,hasAudio:boolean){const args=['-i',input,'-map','0:v:0'];if(hasAudio&&!s.mute)args.push('-map','0:a:0?');args.push('-vf',buildFilters(s,w,h));if(s.format==='mp4')args.push('-c:v','libx264','-preset','ultrafast','-crf','24','-pix_fmt','yuv420p');else args.push('-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','8','-b:v','0','-crf','33');if(hasAudio&&!s.mute){args.push('-af',`atempo=${s.speed.toFixed(5)},volume=${s.volume.toFixed(4)}`);args.push('-c:a',s.format==='mp4'?'aac':'libopus','-b:a','128k')}else args.push('-an');if(s.metadata==='strip')args.push('-map_metadata','-1','-map_chapters','-1');if(s.title.trim())args.push('-metadata',`title=${s.title.trim()}`);if(s.format==='mp4')args.push('-movflags','+faststart');args.push('-y',output);return args}
