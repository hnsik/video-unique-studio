'use strict';
// Catalog fields are evidence about methods, never proof of a successful request.
function capability(provider,m){
 const id=String(m.id||m.name||'').replace(/^models\//,''),methods=m.supportedGenerationMethods||[],output=m.output_modalities||m.architecture?.output_modalities;
 let compatible=null,reason='Каталог не подтверждает маршрут JSON-генерации; нужен тест генерации';
 if(m.active===false||m.lifecycle==='retired'){compatible=false;reason='Модель отключена или выведена из эксплуатации';}
 else if(output?.length&&!output.includes('text')){compatible=false;reason='Нет текстового выхода';}
 else if(provider==='gemini'){
  compatible=methods.includes('generateContent');reason=compatible?'Каталог подтверждает generateContent; JSON проверяется реальным запросом':'Метод generateContent не поддерживается';
  if(/(?:tts|live|image|transcrib|robotic|embedding|veo|imagen)/i.test(id)){compatible=false;reason='Специализированная модель не используется для JSON-планов';}
 }else if(provider==='openrouter'){
  if(m.endpoints?.length&&!m.endpoints.includes('/api/v1/chat/completions')){compatible=false;reason='Нет маршрута chat/completions';}
  else if(output?.includes('text')){compatible=true;reason='Текстовый маршрут; формат JSON и доступ аккаунта требуют теста';}
 }else if(provider==='claude'){compatible=true;reason='Модель Messages из каталога Claude; JSON требует теста';}
 else if(provider==='deepseek'&&output?.includes('text')){compatible=true;reason='Каталог подтверждает текстовый выход; JSON требует теста';}
 else if(/(?:embedding|moderation|whisper|tts|speech|audio|realtime|dall-e|image|guard|sora|babbage|davinci)/i.test(id)){compatible=false;reason='Специализированная модель не подходит для JSON-планов';}
 else if(provider==='openai'&&/^(?:gpt-(?:4o(?:-|$)|4\.1(?:-|$)|[56](?:[.\-]|$))|o[34](?:-|$))/.test(id)){compatible=true;reason='Семейство Responses по документации; доступ и JSON требуют реального теста';}
 else if(provider==='groq'&&/^(?:llama-|meta-llama\/|qwen\/|openai\/gpt-oss|gemma)/.test(id)){compatible=true;reason='Текстовое семейство Groq по документации; JSON требует теста';}
 // Never infer that every model returned by OpenAI/Groq supports this route.
 return {compatible,reason,methods,maxTokens:m.outputTokenLimit||m.max_output_tokens||m.max_completion_tokens||m.top_provider?.max_completion_tokens||m.max_tokens||null,lifecycle:m.lifecycle||null,jsonMode:provider==='openrouter'&&Array.isArray(m.supported_parameters)?m.supported_parameters.includes('response_format'):null};
}
function normalize(provider,m){const id=String(m.id||m.name||'').replace(/^models\//,'');return{id,name:String(m.displayName||m.display_name||m.name||id).slice(0,200),...capability(provider,m),free:provider==='openrouter'&&(id==='openrouter/free'||['prompt','completion'].every(k=>m.pricing?.[k]!==undefined&&Number(m.pricing[k])===0)&&Object.values(m.pricing||{}).every(v=>Number(v)===0))};}
function checkModel(catalog,id){const model=catalog.models.find(m=>m.id===id);if(!model)return{status:'Модель недоступна',compatible:false,reason:'Выбранный ID отсутствует в свежем каталоге; выбор сохранён',id};return{...model,status:model.compatible===false?'Модель недоступна':model.compatible===true?'Работает':'Не проверено',reason:model.reason||'Каталог не содержит сведений о методах'};}
module.exports={normalize,capability,checkModel};
