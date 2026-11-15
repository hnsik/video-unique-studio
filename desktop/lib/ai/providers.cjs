'use strict';
const P=require('./prompts.cjs');
const PROVIDERS={openrouter:{name:'OpenRouter · бесплатный маршрут',model:'openrouter/free',url:'https://openrouter.ai/api/v1/chat/completions'},gemini:{name:'Gemini · Free Tier',model:'gemini-2.5-flash-lite',url:'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent'},groq:{name:'Groq · Free Plan',model:'openai/gpt-oss-20b',url:'https://api.groq.com/openai/v1/chat/completions'}};
function parse(text){if(typeof text!=='string'||text.length>100000)throw Error('Некорректный ответ ИИ');try{return JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw Error('ИИ вернул некорректный JSON');}}
async function request(provider,key,instruction,context,{signal,fetchImpl=fetch,timeout=45000}={}){
 const p=PROVIDERS[provider];if(!p)throw Error('Неизвестный провайдер');
 const system=P.SYSTEM+'\n'+instruction,user=JSON.stringify(context);if(user.length>100000)throw Error('Слишком большой контекст ИИ');
 const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,timeout);
 try{const gemini=provider==='gemini',body=gemini?{systemInstruction:{parts:[{text:system}]},contents:[{role:'user',parts:[{text:user}]}],generationConfig:{responseMimeType:'application/json',temperature:0.35,maxOutputTokens:5000}}:{model:p.model,messages:[{role:'system',content:system},{role:'user',content:user}],temperature:0.35,max_tokens:5000,response_format:{type:'json_object'}};
 const r=await fetchImpl(p.url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...(gemini?{'x-goog-api-key':key}:{Authorization:'Bearer '+key})},body:JSON.stringify(body),signal:controller.signal});
 if(!r.ok){await r.body?.cancel();throw Error(r.status===429?'Лимит бесплатного API исчерпан':r.status===401||r.status===403?'API-ключ отклонён или модель недоступна':`API недоступен (HTTP ${r.status})`);}
 const reader=r.body.getReader();let text='',length=0;const decoder=new TextDecoder();for(;;){const{done,value}=await reader.read();if(done)break;length+=value.length;if(length>200000){await reader.cancel();throw Error('Слишком большой ответ API');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();const data=JSON.parse(text),answer=gemini?data.candidates?.[0]?.content?.parts?.filter(x=>!x.thought).map(x=>x.text||'').join(''):data.choices?.[0]?.message?.content;return parse(answer);
 }catch(e){if(controller.signal.aborted)throw Error(signal?.aborted?'Обработка ИИ отменена':'API не ответил за 45 секунд');if(/API|JSON|ИИ/.test(e.message))throw e;throw Error('Не удалось подключиться к API');}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
module.exports={PROVIDERS,parse,request};
