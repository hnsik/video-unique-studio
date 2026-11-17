'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {PROVIDERS}=require('./providers.cjs');
class Vault{
 constructor(root,safeStorage){this.file=path.join(root,'ai-keys.json');this.safe=safeStorage;this.data={};this.chain=Promise.resolve();}
 async init(){try{this.data=JSON.parse(await fs.readFile(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw Error('Не удалось прочитать защищённые ключи ИИ');}return this;}
 status(){return Object.fromEntries(Object.keys(PROVIDERS).map(k=>[k,!!this.data[k]]));}
 async set(provider,key){if(!PROVIDERS[provider]||typeof key!=='string'||key.length>1000||/[\r\n]/.test(key))throw Error('Некорректный API-ключ');key=key.trim();if(key){if(!this.safe.isEncryptionAvailable()||this.safe.getSelectedStorageBackend?.()==='basic_text')throw Error('Защищённое хранилище недоступно: ключ не сохранён');this.data[provider]=this.safe.encryptString(key).toString('base64');}else delete this.data[provider];const data=JSON.stringify(this.data);this.chain=this.chain.catch(()=>{}).then(async()=>{await fs.writeFile(this.file+'.tmp',data,{mode:0o600});await fs.rename(this.file+'.tmp',this.file);});await this.chain;return this.status();}
 get(provider){if(!this.data[provider])return null;try{return this.safe.decryptString(Buffer.from(this.data[provider],'base64'));}catch{throw Error('Не удалось расшифровать ключ. Введите его заново в настройках ИИ.');}}
}
module.exports={Vault};
