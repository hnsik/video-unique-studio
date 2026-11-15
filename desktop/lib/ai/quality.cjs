'use strict';
// Engineering thresholds, not perceptual or platform guarantees. All units: 0..255.
function assess(r,p){
 const issues=[];
 const add=(code,message,kind='quality')=>issues.push({code,message,kind});
 const effect=r.controlAnalysis?.mae?.mean,mae=r.analysis?.mae?.mean,ssim=r.analysis?.ssim?.mean;
 if(![effect,mae,ssim].every(Number.isFinite))add('measurement','Нет достоверных измерений','technical');
 else{
  if(effect<(p.minEffectMAE??0.05))add('weak',`Недостаточная выраженность: MAE эффектов ${effect.toFixed(2)} < ${p.minEffectMAE??0.05}`,'strength');
  if(mae>p.maxMAE)add('mae',`Слишком большое отличие от исходника: MAE ${mae.toFixed(2)} > ${p.maxMAE}`);
  if(ssim<p.minSSIM)add('ssim',`Снижение структурного сходства: SSIM ${ssim.toFixed(3)} < ${p.minSSIM}`);
 }
 if(r.newBlack)add('black','Новые чёрные интервалы','technical');
 if(r.newFlicker)add('flicker','Дополнительные скачки яркости','technical');
 if(r.audioClipping)add('audio','Пиковый уровень звука близок к перегрузке','technical');
 return{eligible:issues.length===0,issues,effectMAE:effect,mae,ssim};
}
function summarize(trials,p){return trials.flatMap((t,i)=>assess(t,p).issues.map(x=>({...x,sample:i+1})));}
// A single bounded, disclosed local correction. Never adds noise or changes permissions.
function repair(candidate,issues,context,defaults){
 const next=structuredClone(candidate),s=next.settings,codes=new Set(issues.map(x=>x.code)),changes=[];
 const blend=(key,f)=>{s[key]=defaults[key]+(s[key]-defaults[key])*f;};
 if(codes.has('measurement'))return null;
 if(codes.has('audio')&&context.audioAllowed){s.normalize=false;s.volume=Math.min(s.volume,0.85);changes.push('Снижен уровень звука, отключена нормализация');}
 if(codes.has('flicker')){const dynamic=new Set(context.textures.filter(t=>t.dynamic).map(t=>t.id));for(const l of s.layers)if(dynamic.has(l.textureId))l.opacity*=0.5;changes.push('Уменьшена непрозрачность динамических слоёв');}
 if(codes.has('black')){s.layers.forEach(l=>l.opacity*=0.6);blend('brightness',0.5);changes.push('Ослаблены слои и изменение яркости');}
 if(codes.has('ssim')||codes.has('mae')){
  for(const k of ['scale','x','y'])blend(k,0.5);
  for(const k of ['brightness','contrast','saturation','gamma','temperature','hue','sharpness','pixel'])blend(k,0.75);
  s.layers.forEach(l=>l.opacity*=0.75);changes.push('Смягчены изменения изображения; профиль и порог выраженности сохранены');
 }else if(codes.has('weak')&&!codes.has('black')&&!codes.has('flicker')){
  for(const k of ['contrast','saturation','temperature']){
   const [lo,hi]=context.settingsRanges[k],delta=s[k]-defaults[k];
   s[k]=Math.min(hi,Math.max(lo,defaults[k]+(delta||((hi-defaults[k])*0.35))*1.5));
  }
  s.layers.forEach(l=>l.opacity=Math.min(context.maxOpacity,l.opacity*1.5));
  changes.push('Усилены цвет и активные слои без добавления шума');
 }
 if(!changes.length||JSON.stringify(s)===JSON.stringify(candidate.settings))return null;
 return{...next,corrections:changes};
}
module.exports={assess,summarize,repair};
