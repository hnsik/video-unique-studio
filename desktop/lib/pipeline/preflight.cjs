'use strict';
const fs=require('node:fs/promises');
// Prepare the next job's IO checks without another decoder/encoder or unbounded RAM.
async function preflight(s,job){const start=Date.now();try{await fs.access(job.source.path);for(const l of job.settings.layers.filter(l=>l.enabled&&l.opacity>0)){const t=s.texture(l.textureId);if(t.path)await fs.access(t.path);}await fs.access(job.folder,require('node:fs').constants.W_OK);return{ok:true,seconds:(Date.now()-start)/1000};}catch{return{ok:false,seconds:(Date.now()-start)/1000,message:'Следующее задание: проверьте доступность исходника, текстур и выходной папки'};}}
module.exports={preflight};
