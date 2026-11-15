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
class APIError extends Error{constructor(message,status=0,retryAfter=0){super(message);this.status=status;this.retryAfter=retryAfter;}}
function parse(text){if(typeof text!=='string'||text.length>100000)throw Error('Некорректный ответ ИИ');try{return JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw Error('ИИ вернул некорректный JSON');}}
function headers(provider,key,workspace){return{'Content-Type':'application/json',...(provider==='gemini'?{'x-goog-api-key':key}:provider==='claude'?{'x-api-key':key,'anthropic-version':'2026-10-21',...(workspace?{'anthropic-workspace-id':workspace}:{})}:{Authorization:'Bearer '+key})};}
function modelId(id){if(typeof id!=='string'||id.length>200||! /^[a-zA-Z0-9][a-zA-Z0-9_./:-]*$/.test(id)||id.includes('..'))throw Error('Укажите допустимый ID модели');return id.replace(/^models\//,'');}
// Node fetch reuses its process-wide HTTP connection pool. No agent per request.
async function json(url,options,{signal,fetchImpl=fetch,timeout=45000,connectTimeout=10000,limit=200000}={}){
 const c=new AbortController(),abort=()=>c.abort();if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});let stage='соединение / заголовки',timer=setTimeout(abort,Math.min(timeout,connectTimeout));
 try{const r=await fetchImpl(url,{...options,redirect:'error',signal:c.signal});clearTimeout(timer);stage='ответ';timer=setTimeout(abort,timeout);if(!r.ok){const h=r.headers?.get('retry-after'),delay=h?Math.max(0,Number.isFinite(+h)?+h*1000:Date.parse(h)-Date.now()):0;await r.body?.cancel();throw new APIError(r.status===429?'Лимит API исчерпан':r.status===401||r.status===403?'API-ключ отклонён или нет доступа':r.status===404?'Модель или маршрут API не найдены':`API недоступен (HTTP ${r.status})`,r.status,delay);}
 const reader=r.body.getReader();let text='',length=0;const decoder=new TextDecoder();for(;;){const{done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();throw Error('Слишком большой ответ API');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();try{return JSON.parse(text);}catch{throw Error('API вернул некорректный JSON');}
 }catch(e){if(c.signal.aborted)throw new APIError(signal?.aborted?'Обработка ИИ отменена':`API: тайм-аут (${stage}, ${timeout/1000} с)`);if(e instanceof APIError||/API|JSON|ИИ/.test(e.message))throw e;throw new APIError('Не удалось подключиться к API');}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
async function request(provider,key,instruction,context,options={}){const p=PROVIDERS[provider];if(!p)throw Error('Неизвестный провайдер');const model=modelId(options.model||p.model),system=P.SYSTEM+'\n'+instruction,user=JSON.stringify(context),tokens=options.maxTokens||5000;if(user.length>100000)throw Error('Слишком большой контекст ИИ');let url=p.url,body;
 if(provider==='gemini'){if(model.includes('/'))throw Error('Неверный ID Gemini');url+=encodeURIComponent(model)+':generateContent';body={systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:user}]}],generationConfig:{responseMimeType:'application/json',temperature:0.35,maxOutputTokens:tokens}};}
 else if(provider==='claude')body={model,system,messages:[{role:'user',content:user}],max_tokens:tokens};
 else if(provider==='openai')body={model,store:false,input:[{role:'system',content:system},{role:'user',content:user}],max_output_tokens:tokens,text:{format:{type:'json_object'}}};
 else body={model,messages:[{role:'system',content:system},{role:'user',content:user}],temperature:0.35,max_tokens:tokens,response_format:{type:'json_object'}};
 const data=await json(url,{method:'POST',headers:headers(provider,key,options.workspace),body:JSON.stringify(body)},options);
 const answer=provider==='gemini'?data.candidates?.[0]?.content?.parts?.filter(x=>!x.thought).map(x=>x.text||'').join(''):provider==='claude'?data.content?.filter(x=>x.type==='text').map(x=>x.text).join(''):provider==='openai'?data.output?.flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join(''):data.choices?.[0]?.message?.content;
 return parse(answer);
}
async function listModels(provider,key,options={}){const p=PROVIDERS[provider];if(!p)throw Error('Неизвестный провайдер');let cursor,rows=[];for(let page=0;page<10;page++){const url=new URL(p.models);if(provider==='gemini'){url.searchParams.set('pageSize','1000');if(cursor)url.searchParams.set('pageToken',cursor);}if(provider==='claude'){url.searchParams.set('limit','1000');if(cursor)url.searchParams.set('after_id',cursor);}const data=await json(url.toString(),{method:'GET',headers:headers(provider,key,options.workspace)},{...options,limit:8*1048576});for(const m of data.models||data.data||[]){if(provider==='gemini'&&!m.supportedGenerationMethods?.includes('generateContent'))continue;const id=String(m.id||m.name||'').replace(/^models\//,'');try{modelId(id);}catch{continue;}rows.push({id,name:String(m.displayName||m.display_name||m.name||id).slice(0,200),free:provider==='openrouter'&&(id==='openrouter/free'||String(m.pricing?.prompt)==='0'&&String(m.pricing?.completion)==='0')});}cursor=data.nextPageToken||(data.has_more?data.last_id:null);if(!cursor)return rows.slice(0,5000);}throw Error('Слишком много страниц каталога моделей');}
module.exports={PROVIDERS,APIError,parse,request,listModels,modelId};
