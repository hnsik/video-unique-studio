'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function identity(file){const s=await fs.stat(file);return{path:path.resolve(file),size:s.size,mtime:s.mtimeMs,ctime:s.ctimeMs};}
class Cache{
 constructor(root,{bytes=64*1048576,ttl=86400000}={}){this.root=root;this.bytes=bytes;this.ttl=ttl;}
 async get(key){try{const p=path.join(this.root,digest(key)+'.json'),s=await fs.stat(p);if(Date.now()-s.mtimeMs>this.ttl)return null;return JSON.parse(await fs.readFile(p,'utf8'));}catch(e){if(['ENOENT','SyntaxError'].includes(e.code||e.name))return null;throw e;}}
 async put(key,value){await fs.mkdir(this.root,{recursive:true});const data=JSON.stringify(value);if(Buffer.byteLength(data)>this.bytes)return;const p=path.join(this.root,digest(key)+'.json'),tmp=p+'.'+randomUUID()+'.tmp';await fs.writeFile(tmp,data);await fs.rename(tmp,p);await require('../performance/runtime.cjs').prune(this.root,this.bytes,[p]);}
}
module.exports={Cache,identity,digest};
