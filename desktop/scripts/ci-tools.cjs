"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { ensureTools } = require("../lib/dependencies.cjs");
(async () => {
  const tools = await ensureTools({
    root: path.join(
      process.env.LOCALAPPDATA || os.tmpdir(),
      "VideoUniqueStudio",
    ),
    onProgress: (state) => {
      if (
        state.phase !== "download" ||
        Math.floor(state.percent || 0) % 20 === 0
      )
        console.log(state.message);
    },
  });
  if (process.env.GITHUB_PATH)
    await fs.appendFile(
      process.env.GITHUB_PATH,
      path.dirname(tools.ffmpeg) + "\n",
    );
  if(process.env.VUS_BUNDLE_TOOLS==='1') {
    const target=path.join(__dirname,'../bundled-tools');
    await fs.mkdir(target,{recursive:true});
    await fs.copyFile(tools.ffmpeg,path.join(target,'ffmpeg.exe'));
    await fs.copyFile(tools.ffprobe,path.join(target,'ffprobe.exe'));
    for(const name of ['LICENSE','SOURCE-AND-LICENSE.txt']) await fs.copyFile(path.join(path.dirname(tools.ffmpeg),name),path.join(target,name));
  }
  console.log(tools.version);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

