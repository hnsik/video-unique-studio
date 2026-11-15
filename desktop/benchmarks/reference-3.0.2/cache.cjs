'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
// Only application-generated previews/proxies. Imported media and exports are never touched.
async function entries(root){const all=[];for(const name of ['proxy','preview','generator-preview']){const dir=path.join(root,name);await fs.mkdir(dir,{recursive:true});for(const e of await fs.readdir(dir,{withFileTypes:true})){if(!e.isFile())continue;const file=path.join(dir,e.name),s=await fs.stat(file);all.push({file,size:s.size,mtime:s.mtimeMs});}}return all;}
async function prune(root,budget,keep=[]){const files=await entries(root);let size=files.reduce((s,f)=>s+f.size,0),removed=0;for(const f of files.sort((a,b)=>a.mtime-b.mtime)){if(size<=budget)break;if(keep.includes(f.file))continue;await fs.rm(f.file,{force:true});size-=f.size;removed++;}return {bytes:size,removed};}
module.exports={entries,prune};
