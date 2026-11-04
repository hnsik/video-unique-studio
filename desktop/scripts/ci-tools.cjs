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
  console.log(tools.version);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
