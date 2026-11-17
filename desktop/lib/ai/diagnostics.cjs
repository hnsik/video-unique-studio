'use strict';
const{randomUUID}=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');
const{PROVIDERS,redact}=require('./providers.cjs'),{checkModel}=require('./capabilities.cjs');
const state=(status='Не проверено',reason='')=>({status,reason});
function failure(e,provider,model){return{status:e.status===402?'Требуется биллинг':e.details?.type==='model_unavailable'||e.details?.type==='incompatible_model'?'Модель недоступна':'Ошибка',reason:redact(e.message),details:{provider,model,...e.details,httpStatus:e.status||0}};}
class Diagnostics{
 constructor(ai){this.ai=ai;this.job=null;this.promise=Promise.resolve();}
 snapshot(){if(!this.job)return null;const{controller,options,...j}=this.job;return structuredClone(j);}
 emit(){this.ai.s.onEvent({aiDiagnostics:this.snapshot()});}
 cancel(){if(this.job?.status==='running'){this.job.controller.abort();this.job.status='cancelling';if(this.processing)this.ai.s.cancel();this.emit();}}
 start({providers=Object.keys(PROVIDERS),generation=false,consent=false,force=true}={}){
  if(this.job&&['running','cancelling'].includes(this.job.status))return this.job.id;
  if(!Array.isArray(providers)||!providers.length||providers.length>6||new Set(providers).size!==providers.length||providers.some(p=>!PROVIDERS[p]))throw Error('Выберите известные провайдеры');
  if(generation&&!consent)throw Error('Тест генерации требует отдельного согласия');
  const options=structuredClone(this.ai.options()),j={id:randomUUID(),status:'running',started:new Date().toISOString(),controller:new AbortController(),options,rows:providers.map(provider=>({provider,name:PROVIDERS[provider].name,modelId:options.models?.[provider]||PROVIDERS[provider].model||'',catalog:state(),model:state(),generation:state(),pipeline:state()}))};this.job=j;
  let index=0;const worker=async()=>{while(index<j.rows.length&&!j.controller.signal.aborted){const row=j.rows[index++];await this.row(j,row,{generation,force});this.emit();}};
  this.promise=Promise.all([worker(),worker()]).finally(()=>{j.status=j.controller.signal.aborted?'cancelled':'done';j.finished=new Date().toISOString();this.emit();});this.emit();return j.id;
 }
 async row(j,row,{generation,force}){
  const signal=j.controller.signal,o=j.options,p=row.provider,start=Date.now();
  try{
   if(!this.ai.vault.get(p)){for(const k of ['catalog','model','generation'])row[k]=state('Требуется API-ключ');return;}
   row.catalog=state('Не проверено','Запрос каталога…');this.emit();
   let catalog;try{catalog=await this.ai.manager.models(p,{force,signal,workspace:o.workspace});row.catalog={...state(catalog.models.length?'Работает':'Ошибка',catalog.models.length?`${catalog.models.length} моделей; ${catalog.keyCheck}`:'API вернул пустой каталог'),date:catalog.date,cached:catalog.cached,route:catalog.route};row.models=catalog.models;}
   catch(e){row.catalog=failure(e,p,row.modelId);row.catalog.lastSuccess=await this.ai.manager.lastCatalog(p,o.workspace);row.model=state('Не проверено','Каталог недоступен; совместимость модели не подтверждена');if(!generation||!row.modelId||e.status===401||e.status===429)return;}
   if(catalog)row.model=checkModel(catalog,row.modelId);row.model.scope='Только каталог и документированные методы; генерация отдельно';
   if(o.autoModel&&row.model.compatible===false){try{const route=await this.ai.manager.resolve({provider:p,model:row.modelId},{...o,autoModel:true},signal);row.modelId=route.model;row.model=checkModel(catalog,route.model);row.autoSelected=true;}catch(e){row.model=failure(e,p,row.modelId);}}
   if(!generation)return;
   if(row.model.status==='Модель недоступна'){row.generation=state('Не проверено','Выберите совместимую модель');return;}
   try{await this.ai.manager.guard({provider:p,model:row.modelId},o,signal);}catch(e){row.generation=state(['gemini','groq'].includes(p)&&!o.freeAccount&&!o.allowBilling?'Не проверено':'Требуется биллинг',e.message);return;}
   row.generation=state('Не проверено','Отправлен один тестовый запрос…');this.emit();
   const{DEFAULT}=require('../studio3.cjs'),{catalog:library}=require('../textures.cjs'),{cleanPlan,PROFILES,ranges}=require('./engine.cjs'),context={profile:'light',seed:12345,analysis:{meanLuma:100,audio:{available:false}},textures:library.slice(0,3).map(t=>({id:t.id,kind:t.kind,category:t.category,dynamic:t.dynamic})),settingsRanges:ranges('light'),audioAllowed:false,geometryAllowed:false,timeAllowed:false,...PROFILES.light};let candidates;
   const started=Date.now();try{await this.ai.manager.call({...o,provider:p,models:{...o.models,[p]:row.modelId},autoModel:false,autoSwitch:false,validateCatalog:!!catalog,reusePlans:false,retries:0},require('./prompts.cjs').PLAN+' Диагностический короткий план: только brightness=0.005, layers=[]; три варианта. Без пользовательских данных.',context,{signal,budget:{remaining:1},maxTokens:2000,validateReply:reply=>{candidates=cleanPlan(reply,context,DEFAULT,12345);}});row.generation={...state('Работает','Реальный ответ и JSON-план прошли валидацию'),date:new Date().toISOString(),seconds:(Date.now()-started)/1000,route:PROVIDERS[p].url,requests:1};}
   catch(e){row.generation=failure(e,p,row.modelId);return;}
   row.pipeline=state('Не проверено','Ожидание короткого синтетического экспорта');this.emit();
   try{await this.ai.s.exclusive('Проверка JSON-плана '+p,()=>this.pipeline(j,candidates[0]));row.pipeline=state('Работает','JSON → обработчик → FFmpeg → FFprobe, синтетический кадр');}catch(e){row.pipeline=failure(e,p,row.modelId);}
  }catch(e){if(!signal.aborted)row.catalog=failure(e,p,row.modelId);}finally{row.seconds=(Date.now()-start)/1000;if(signal.aborted)for(const k of ['catalog','model','generation','pipeline'])if(row[k].status==='Не проверено')row[k].reason='Диагностика отменена';}
 }
 async pipeline(j,candidate){const s=this.ai.s;if(j.controller.signal.aborted)throw Error('Диагностика отменена');this.processing=true;const dir=await fs.mkdtemp(path.join(this.ai.root,'diagnostic-'));try{const file=path.join(dir,'source.mp4');await s.run(s.tools.ffmpeg,['-v','error','-y','-f','lavfi','-i','testsrc2=s=64x64:r=4:d=0.5','-c:v','libx264','-threads','1',file]);if(j.controller.signal.aborted)throw Error('Диагностика отменена');const source={id:randomUUID(),kind:'video',name:'Синтетический тест',path:file,probe:await s.probe(file)};await s.process({source,settings:{...candidate.settings,width:64,height:64,fps:4,analysis:false,mute:true,qcMode:'probe',preset:'ultrafast'},folder:dir,index:1});}finally{this.processing=false;for(const[id,file]of s.outputs)if(file.startsWith(dir+path.sep))s.outputs.delete(id);await fs.rm(dir,{recursive:true,force:true});}}
}
module.exports={Diagnostics,failure};
