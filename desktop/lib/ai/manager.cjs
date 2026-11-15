'use strict';
const path=require('node:path'),{createHash}=require('node:crypto'),{Cache,digest}=require('../pipeline/cache.cjs'),{PROVIDERS,request,listModels,modelId,APIError}=require('./providers.cjs'),{checkModel}=require('./capabilities.cjs'),{Pool,join}=require('./concurrency.cjs');
function sleep(ms,signal){return new Promise((resolve,reject)=>{if(signal?.aborted)return reject(Error('Обработка ИИ отменена'));const finish=()=>{signal?.removeEventListener('abort',cancel);resolve();},timer=setTimeout(finish,ms),cancel=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);reject(Error('Обработка ИИ отменена'));};signal?.addEventListener('abort',cancel,{once:true});});}
class Manager{
 constructor(root,vault,transport=request,catalogTransport=listModels){this.catalogTransport=catalogTransport;this.cooldowns=new Map();this.inflight=new Map();this.catalogPool=new Pool(2);this.vault=vault;this.transport=transport;this.modelsCache=new Cache(path.join(root,'models-cache'),{ttl:3600000});this.catalogHistory=new Cache(path.join(root,'catalog-history'),{ttl:30*86400000,bytes:1048576});this.replyCache=new Cache(path.join(root,'response-cache'),{ttl:600000,bytes:8*1048576});}
 account(provider){return createHash('sha256').update(this.vault.get(provider)||'').digest('hex');}
 async lastCatalog(provider,workspace){return this.catalogHistory.get({provider,account:this.account(provider),workspace});}
 async models(provider,{force=false,signal,workspace}={}){
  if(!PROVIDERS[provider])throw Error('Неизвестный провайдер');if(!this.vault.get(provider))throw Error('Требуется API-ключ');
  const key={version:3,provider,account:this.account(provider),workspace},id=digest(key);
  if(signal?.aborted)throw Error('Диагностика отменена');if(!force){const hit=await this.modelsCache.get(key);if(hit)return{...hit,cached:true};}
  const catalogLimit='catalog:'+provider+this.account(provider),until=this.cooldowns.get(catalogLimit)||0;if(until>Date.now())throw new APIError('Каталог: ожидается Retry-After',429,until-Date.now(),{provider,route:PROVIDERS[provider].models,operation:'catalog'});let entry=this.inflight.get(id);if(entry?.controller.signal.aborted)entry=null;
  if(!entry){entry={controller:new AbortController(),users:0,done:false};const current=entry;entry.promise=this.catalogPool.run(async()=>{let models;try{models=await this.catalogTransport(provider,this.vault.get(provider),{signal:current.controller.signal,workspace});}catch(e){if(e.status===429)this.cooldowns.set(catalogLimit,Date.now()+Math.max(e.retryAfter||0,1000));throw e;}const result={models,date:new Date().toISOString(),cached:false,route:PROVIDERS[provider].models,keyCheck:provider==='openrouter'?'Не подтверждён: каталог публичный':'Каталог ответил с этим ключом; генерация не проверена'};if(current.controller.signal.aborted)throw Error('Диагностика отменена');await this.modelsCache.put(key,result);await this.catalogHistory.put({provider,account:this.account(provider),workspace},{date:result.date,count:models.length});return result;},entry.controller.signal).finally(()=>{current.done=true;if(this.inflight.get(id)===current)this.inflight.delete(id);});this.inflight.set(id,entry);}
  return join(entry,signal);
 }
 routes(o){const selected={provider:o.provider,model:o.models?.[o.provider]||PROVIDERS[o.provider]?.model},list=[selected,...(o.autoSwitch?o.allowedRoutes||[]:[])],seen=new Set();return list.map(r=>{if(!PROVIDERS[r.provider])throw Error('Неизвестный провайдер маршрута');return{provider:r.provider,model:r.model?modelId(r.model):''};}).filter(r=>{const k=r.provider+'|'+r.model;if(seen.has(k))return false;seen.add(k);return true;});}
 async guard(route,o,signal){if(!this.vault.get(route.provider))throw Error('Нет API-ключа: '+route.provider);if(PROVIDERS[route.provider].paid&&!o.allowBilling)throw Error('Платные API-запросы не разрешены');if(['gemini','groq'].includes(route.provider)&&!o.freeAccount&&!o.allowBilling)throw Error('Подтвердите бесплатный аккаунт или разрешите биллинг');if(route.provider==='openrouter'&&route.model&&route.model!=='openrouter/free'&&!o.allowBilling){const catalog=await this.models(route.provider,{signal,workspace:o.workspace});if(!catalog.models.some(m=>m.id===route.model&&m.free))throw Error('Не подтверждён бесплатный маршрут OpenRouter');}}
 async resolve(route,o,signal,excluded=new Set()){
  const catalog=await this.models(route.provider,{signal,workspace:o.workspace});let model=catalog.models.find(m=>m.id===route.model);
  if((!model||model.compatible===false||excluded.has(model.id))&&o.autoModel){model=catalog.models.find(m=>m.compatible===true&&!excluded.has(m.id)&&(o.allowBilling||route.provider!=='openrouter'||m.free));}
  if(!model)throw new APIError('Модель недоступна в каталоге: '+(route.model||'не выбрана'),0,0,{provider:route.provider,model:route.model,type:'model_unavailable',route:PROVIDERS[route.provider].models,recommendation:'Обновите каталог, выберите модель или включите автоподбор модели.'});
  if(model.compatible===false)throw new APIError(model.reason||'Неподдерживаемая модель',0,0,{provider:route.provider,model:model.id,type:'incompatible_model',route:PROVIDERS[route.provider].url});
  return{provider:route.provider,model:model.id,capability:model};
 }
 async call(o,instruction,context,{signal,budget={remaining:6},onEvent=()=>{},maxTokens=5000,validateReply}={}){
  let error;const routes=this.routes(o),attempted=new Set(),retries=Math.min(2,Math.max(0,o.retries??1));
  for(let index=0;index<routes.length&&index<12;index++){
   let route=routes[index];const cooldownKey=route.provider+this.account(route.provider);
   if((this.cooldowns.get(cooldownKey)||0)>Date.now()){error=new APIError('Лимит API: ожидается Retry-After для '+route.provider,429,this.cooldowns.get(cooldownKey)-Date.now(),{provider:route.provider,model:route.model});continue;}
   if(signal?.aborted)throw Error('Обработка ИИ отменена');
   try{await this.guard(route,o,signal);if(o.autoModel||o.validateCatalog)route=await this.resolve(route,{...o,autoModel:o.autoModel&&route.provider===o.provider},signal,new Set([...attempted].filter(x=>x.startsWith(route.provider+'|')).map(x=>x.split('|')[1])));await this.guard(route,o,signal);}catch(e){error=e;onEvent({stage:'Маршрут отклонён',...route,details:e.details,message:e.message});continue;}
   if(!route.model){error=Error('Укажите ID модели');continue;}const identity=route.provider+'|'+route.model;if(attempted.has(identity))continue;attempted.add(identity);
   const key={v:3,route:{provider:route.provider,model:route.model},account:this.account(route.provider),instruction,context};
   if(o.reusePlans){const hit=await this.replyCache.get(key);if(hit){validateReply?.(hit);onEvent({stage:'Кэш ответа ИИ',...route,cached:true,seconds:0});return{reply:hit,...route,cached:true};}}
   for(let retry=0;retry<=retries;retry++){
    if(--budget.remaining<0)throw Error('Достигнут лимит API-запросов для одного видео');const begin=Date.now();
    try{const reply=await this.transport(route.provider,this.vault.get(route.provider),instruction,context,{signal,model:route.model,workspace:o.workspace,timeout:45000,connectTimeout:10000,maxTokens:Math.min(maxTokens,route.capability?.maxTokens||maxTokens),jsonMode:route.capability?.jsonMode});validateReply?.(reply);onEvent({stage:'Ответ ИИ',...route,seconds:(Date.now()-begin)/1000,retry});if(o.reusePlans)await this.replyCache.put(key,reply);return{reply,...route,cached:false};}
    catch(e){error=e;onEvent({stage:'Ошибка API',provider:route.provider,model:route.model,status:e.status||0,details:e.details,message:e.message,seconds:(Date.now()-begin)/1000,retry});if(signal?.aborted)throw e;
     if([401,403].includes(e.status)){for(let k=routes.length-1;k>index;k--)if(routes[k].provider===route.provider)routes.splice(k,1);break;}
     if(e.status===404){try{const catalog=await this.models(route.provider,{force:true,signal,workspace:o.workspace});if(e.details)e.details.catalogFinding=checkModel(catalog,route.model);if(o.autoModel&&route.provider===o.provider)routes.push({provider:route.provider,model:''});}catch(catalogError){if(e.details)e.details.catalogRefreshError=catalogError.details||{message:catalogError.message};}break;}
     const delay=Math.max(e.retryAfter||0,500*2**retry);if(e.status===429)this.cooldowns.set(cooldownKey,Date.now()+delay);
     if(![429,500,502,503,504].includes(e.status)||retry===retries||delay>15000)break;
     onEvent({stage:'Ожидание API',provider:route.provider,model:route.model,waitSeconds:delay/1000});await sleep(delay,signal);
    }
   }
  }throw error||Error('Нет разрешённого доступного маршрута ИИ');
 }
}
module.exports={Manager,sleep};
