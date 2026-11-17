'use strict';
const P=require('./prompts.cjs');
const PROVIDERS={
 openrouter:{name:'OpenRouter',model:'openrouter/free',url:'https://openrouter.ai/api/v1/chat/completions',models:'https://openrouter.ai/api/v1/models'},
 gemini:{name:'Google Gemini',model:'gemini-2.5-flash-lite',url:'https://generativelanguage.googleapis.com/v1beta/models/',models:'https://generativelanguage.googleapis.com/v1beta/models'},
 groq:{name:'Groq',model:'openai/gpt-oss-20b',url:'https://api.groq.com/openai/v1/chat/completions',models:'https://api.groq.com/openai/v1/models'},
 openai:{name:'OpenAI',model:'',url:'https://api.openai.com/v1/responses',models:'https://api.openai.com/v1/models',paid:true},
 claude:{name:'Claude',model:'',url:'https://api.anthropic.com/v1/messages',models:'https://api.anthropic.com/v1/models',paid:true},
 deepseek:{name:'DeepSeek',model:'',url:'https://api.deepseek.com/chat/completions',models:'https://api.deepseek.com/models',paid:true}
};
function redact(value,secrets=[]){let s=String(value||'');for(const key of secrets.filter(Boolean))s=s.split(key).join('[скрыто]');return s.replace(/(?:Bearer\s+)[^\s"']+/gi,'Bearer [скрыто]').replace(/(?:sk-|AIza)[A-Za-z0-9_\-]{10,}/g,'[скрыто]').replace(/([?&](?:key|api_key|token|access_token)=)[^&\s]+/gi,'$1[скрыто]').replace(/[A-Za-z0-9_+\/=-]{48,}/g,'[скрыто]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[email]').replace(/[\x00-\x1f]/g,' ').slice(0,700);}
const actions={400:'Проверьте параметры запроса и совместимость модели с JSON.',401:'Проверьте ключ в настройках выбранного провайдера.',402:'Проверьте баланс и разрешение биллинга.',403:'Проверьте права ключа, ограничения проекта или региона.',404:'Обновите каталог; проверьте ID и поддерживаемый маршрут.',429:'Дождитесь Retry-After; проверьте квоту аккаунта.'};
class APIError extends Error{constructor(message,status=0,retryAfter=0,details={}){super(message);this.status=status;this.retryAfter=retryAfter;this.details={httpStatus:status,type:details.type||'api_error',message,retryAfterMs:retryAfter,recommendation:actions[status]||(status>=500?'Временная ошибка сервиса. Повторите позже.':'Проверьте сеть и маршрут API.'),...details};}}
async function readBody(r,limit){const reader=r.body.getReader();let text='',length=0;const decoder=new TextDecoder();for(;;){const{done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();throw Error('Слишком большой ответ API');}text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}
function parse(text){if(typeof text!=='string'||text.length>100000)throw Error('Некорректный ответ ИИ');try{return JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw Error('ИИ вернул некорректный JSON');}}
function headers(provider,key,workspace){return{'Content-Type':'application/json',...(provider==='gemini'?{'x-goog-api-key':key}:provider==='claude'?{'x-api-key':key,'anthropic-version':'2026-10-21',...(workspace?{'anthropic-workspace-id':workspace}:{})}:{Authorization:'Bearer '+key})};}
function modelId(id){if(typeof id!=='string'||id.length>200||! /^[a-zA-Z0-9][a-zA-Z0-9_./:-]*$/.test(id)||id.includes('..'))throw Error('Укажите допустимый ID модели');return id.replace(/^models\//,'');}
// Node fetch reuses its process-wide HTTP connection pool. No agent per request.
async function json(url,options,{signal,fetchImpl=fetch,timeout=45000,connectTimeout=10000,limit=200000}={}){
 const c=new AbortController(),abort=()=>c.abort();if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});let stage='соединение / заголовки',timer=setTimeout(abort,Math.min(timeout,connectTimeout));
 try{const r=await fetchImpl(url,{...options,redirect:'error',signal:c.signal});clearTimeout(timer);stage='ответ';timer=setTimeout(abort,timeout);if(!r.ok){const h=r.headers?.get('retry-after'),delay=h?Math.max(0,Number.isFinite(+h)?+h*1000:Date.parse(h)-Date.now()):0;let message='',type='http_error';try{const text=await readBody(r,16384);let body;try{body=JSON.parse(text);}catch{message=text.trim().startsWith('<')?'API вернул HTML вместо JSON':text;}if(body){message=body.error?.message||body.message||'';type=body.error?.type||body.error?.status||body.error?.code||type;}}catch{}const secrets=Object.values(options.headers||{}).flatMap(v=>[v,String(v).replace(/^Bearer /,'')]),route=new URL(url);const clean=redact(message,secrets)||'API недоступен';throw new APIError(`HTTP ${r.status}: ${clean}`,r.status,Number.isFinite(delay)?delay:0,{route:route.origin+route.pathname,type:redact(type,secrets),message:clean});}
 const text=await readBody(r,limit);try{return JSON.parse(text);}catch{throw Error('API вернул некорректный JSON');}
 }catch(e){if(c.signal.aborted)throw new APIError(signal?.aborted?'Обработка ИИ отменена':`API: тайм-аут (${stage}, ${(stage==='ответ'?timeout:Math.min(timeout,connectTimeout))/1000} с)`);if(e instanceof APIError||/API|JSON|ИИ/.test(e.message))throw e;throw new APIError('Не удалось подключиться к API');}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
async function request(provider,key,instruction,context,options={}){const p=PROVIDERS[provider];if(!p)throw Error('Неизвестный провайдер');const model=modelId(options.model||p.model),system=P.SYSTEM+'\n'+instruction,user=JSON.stringify(context),tokens=options.maxTokens||5000;if(user.length>100000)throw Error('Слишком большой контекст ИИ');let url=p.url,body;
 if(provider==='gemini'){if(model.includes('/'))throw Error('Неверный ID Gemini');url+=encodeURIComponent(model)+':generateContent';body={systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:user}]}],generationConfig:{responseMimeType:'application/json',temperature:0.35,maxOutputTokens:tokens}};}
 else if(provider==='claude')body={model,system,messages:[{role:'user',content:user}],max_tokens:tokens};
 else if(provider==='openai')body={model,store:false,input:[{role:'system',content:system},{role:'user',content:user}],max_output_tokens:tokens,text:{format:{type:'json_object'}}};
 else body={model,messages:[{role:'system',content:system},{role:'user',content:user}],temperature:0.35,max_tokens:tokens,...(options.jsonMode===false?{}:{response_format:{type:'json_object'}})};
 let data;try{data=await json(url,{method:'POST',headers:headers(provider,key,options.workspace),body:JSON.stringify(body)},options);}catch(e){if(e.details)Object.assign(e.details,{provider,model,operation:'generation'});throw e;}
 const answer=provider==='gemini'?data.candidates?.[0]?.content?.parts?.filter(x=>!x.thought).map(x=>x.text||'').join(''):provider==='claude'?data.content?.filter(x=>x.type==='text').map(x=>x.text).join(''):provider==='openai'?data.output?.flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join(''):data.choices?.[0]?.message?.content;
 try{return parse(answer);}catch(e){throw new APIError(e.message,0,0,{provider,model,route:url,type:(!answer?'empty_response':'invalid_json'),recommendation:'Модель ответила, но JSON не получен. Проверьте совместимость и лимит токенов.'});}
}
async function listModels(provider,key,options={}){
 const p=PROVIDERS[provider];if(!p)throw Error('Неизвестный провайдер');let cursor,rows=[],seen=new Set();
 for(let page=0;page<10;page++){
  const url=new URL(p.models);if(provider==='gemini'){url.searchParams.set('pageSize','1000');if(cursor)url.searchParams.set('pageToken',cursor);}if(provider==='claude'){url.searchParams.set('limit','1000');if(cursor)url.searchParams.set('after_id',cursor);}
  let data;try{data=await json(url.toString(),{method:'GET',headers:headers(provider,key,options.workspace)},{...options,limit:8*1048576});}catch(e){if(e.details)Object.assign(e.details,{provider,operation:'catalog'});throw e;}
  const items=data.models||data.data;if(!Array.isArray(items))throw new APIError('Каталог не содержит массив моделей',0,0,{provider,type:'invalid_catalog',route:p.models});
  for(const m of items){const item=require('./capabilities.cjs').normalize(provider,m);try{modelId(item.id);}catch{continue;}if(!seen.has(item.id)){rows.push(item);seen.add(item.id);}}
  const next=data.nextPageToken||(data.has_more?data.last_id:null);if(!next)return rows.slice(0,5000);if(next===cursor)throw Error('API повторяет страницу каталога');cursor=next;
 }throw Error('Слишком много страниц каталога моделей');
}
module.exports={PROVIDERS,APIError,parse,request,listModels,modelId,redact};
