"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
(async () => {
  const root = path.resolve(__dirname, "../..");
  const result = spawnSync(
    process.execPath,
    [path.join(root, "node_modules/next/dist/bin/next"), "build"],
    {
      cwd: root,
      env: { ...process.env, VUS_DESKTOP: "1", NEXT_PUBLIC_DESKTOP: "1" },
      stdio: "inherit",
    },
  );
  if (result.status !== 0) process.exit(result.status || 1);
  const target = path.join(root, "desktop/renderer");
  await fs.rm(target, { recursive: true, force: true });
  await fs.cp(path.join(root, ".next-desktop"), target, {
    recursive: true,
    filter: (src) =>
      !path
        .relative(path.join(root, ".next-desktop"), src)
        .split(path.sep)
        .includes("ffmpeg"),
  });
  console.log("Desktop renderer prepared");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
