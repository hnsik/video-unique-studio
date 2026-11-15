'use strict';
const fs=require('node:fs/promises'),fss=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),{pipeline}=require('node:stream/promises'),{Readable}=require('node:stream'),{createHash}=require('node:crypto'),AdmZip=require('adm-zip');
(async()=>{
 const root=path.resolve(__dirname,'../..'),out=path.join(root,'desktop-dist');await fs.mkdir(out,{recursive:true});
 const source=path.join(out,'VideoUniqueStudio-3.0-Source.zip');execFileSync('git',['archive','--format=zip','--output='+source,'HEAD'],{cwd:root});const zip=new AdmZip(source);zip.addLocalFolder(path.join(root,'desktop/assets/textures'),'desktop/assets/textures');zip.writeZip(source);
 const textures=new AdmZip();textures.addLocalFolder(path.join(root,'desktop/assets/textures'));textures.writeZip(path.join(out,'VideoUniqueStudio-110-Textures.zip'));
 const manifest=require('../ffmpeg-manifest.json'),commit=manifest.source.split('/').at(-1),url=`https://codeload.github.com/FFmpeg/FFmpeg/zip/${commit}`,file=path.join(out,`FFmpeg-${manifest.version}-Source.zip`);
 const response=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!response.ok)throw Error('FFmpeg source download: '+response.status);await pipeline(Readable.fromWeb(response.body),fss.createWriteStream(file));
 const ffmpeg=path.join(root,'desktop/bundled-tools/ffmpeg.exe');const build=execFileSync(ffmpeg,['-buildconf'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 await fs.writeFile(path.join(out,'FFmpeg-SOURCES.txt'),`FFmpeg ${manifest.version}\nBinary provider: ${manifest.provider}\nPinned upstream source: ${manifest.source}\nSource archive: ${path.basename(file)}\nLicense: ${manifest.license}. LICENSE and SOURCE-AND-LICENSE.txt are installed in resources/ffmpeg.\nExternal library inventory and source information: ${manifest.provider}#libraries\nBuild configuration:\n${build}\n`);
 for(const name of await fs.readdir(out))if(name.endsWith('.zip')){const h=createHash('sha256');for await(const b of fss.createReadStream(path.join(out,name)))h.update(b);await fs.writeFile(path.join(out,name+'.sha256'),h.digest('hex')+'  '+name+'\n');}
})().catch(e=>{console.error(e);process.exitCode=1;});
