"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {
  NativeEngine,
  validateArgs,
  validateFilters,
  safeName,
} = require("../lib/native-engine.cjs");
const {
  ensureTools,
  validatePair,
  installArchive,
} = require("../lib/dependencies.cjs");
const AdmZip = require("adm-zip");
test("native command boundary rejects traversal, protocols, unapproved filters and arbitrary options", () => {
  for (const name of [
    "../input",
    "C:\\secret",
    "/etc/passwd",
    "con.exe",
    "..",
    "-input",
  ])
    assert.throws(() => safeName(name));
  assert.throws(() =>
    validateArgs("ffmpeg", ["-i", "https://example.com/private", "out.mp4"]),
  );
  assert.throws(() =>
    validateArgs("ffmpeg", ["-i", "input", "-attach", "secret", "out.mp4"]),
  );
  assert.throws(() => validateFilters("movie=/etc/passwd"));
  validateArgs("ffmpeg", [
    "-i",
    "input",
    "-vf",
    "setpts=(PTS-STARTPTS)/1.05,scale=96:64,select=eq(n\\,3)+eq(n\\,8)",
    "-map",
    "0:v:0",
    "-t",
    "2",
    "-y",
    "out.mp4",
  ]);
  validateArgs("ffmpeg", [
    "-i",
    "input",
    "-i",
    "layer.png",
    "-filter_complex",
    "[0:v]fps=30[base0];[base0][1:v]overlay=0:0:eof_action=repeat:enable='between(t,0,1)'[base1]",
    "-map",
    "[base1]",
    "out.mp4",
  ]);
  validateArgs("ffprobe", [
    "-v",
    "error",
    "-count_frames",
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    "input",
    "-o",
    "probe.json",
  ]);
});
test("finds existing compatible FFmpeg pair, supports chunked IO, native execution, probing and session ownership", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vus-native-test-"));
  let engine;
  try {
    const tools = await ensureTools({
      root: path.join(root, "tools"),
      platform: process.platform,
    });
    assert(tools.version.includes("ffmpeg version"));
    engine = new NativeEngine({ tools, root: path.join(root, "jobs") });
    const id = await engine.create(10);
    await engine.write(id, 10, "note.txt", new Uint8Array([1, 2]), 0);
    await engine.write(id, 10, "note.txt", new Uint8Array([3]), 2);
    assert.equal(await engine.stat(id, 10, "note.txt"), 3);
    assert.deepEqual(
      Array.from(await engine.read(id, 10, "note.txt", 0, 3)),
      [1, 2, 3],
    );
    await assert.rejects(() => engine.stat(id, 11, "note.txt"), /Сессия/);
    // Supply an existing tiny fixture as bytes, as the desktop renderer does.
    const { execFile } = require("node:child_process");
    const { promisify } = require("node:util");
    const exec = promisify(execFile);
    const input = path.join(root, "input.mp4");
    await exec(tools.ffmpeg, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=32x32:r=30:d=0.5",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-y",
      input,
    ]);
    await engine.write(
      id,
      10,
      "input",
      new Uint8Array(await fs.readFile(input)),
      0,
    );
    await engine.run(id, 10, "ffmpeg", [
      "-v",
      "error",
      "-i",
      "input",
      "-vf",
      "fps=30,trim=end_frame=15",
      "-vsync",
      "0",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-t",
      "0.5",
      "-y",
      "out.mp4",
    ]);
    await engine.run(id, 10, "ffprobe", [
      "-v",
      "error",
      "-count_frames",
      "-show_format",
      "-show_streams",
      "-of",
      "json",
      "out.mp4",
      "-o",
      "probe.json",
    ]);
    const probe = JSON.parse(
      await engine.read(id, 10, "probe.json", 0, 0, "utf8"),
    );
    assert.equal(probe.streams[0].nb_read_frames, "15");
    await engine.close(id, 10);
    await assert.rejects(() => engine.stat(id, 10, "out.mp4"), /Сессия/);
  } finally {
    await engine?.closeAll();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("archive installer accepts only expected binary basenames and validates before activating tools", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vus-archive-test-"));
  try {
    const zip = new AdmZip();
    zip.addFile("build/bin/ffmpeg.exe", Buffer.from("fake-ffmpeg"));
    zip.addFile("build/bin/ffprobe.exe", Buffer.from("fake-ffprobe"));
    zip.addFile("../outside.txt", Buffer.from("must-not-write"));
    const archive = path.join(root, "archive.zip");
    zip.writeZip(archive);
    const validate = async (fm, fp) => {
      assert.equal(await fs.readFile(fm, "utf8"), "fake-ffmpeg");
      assert.equal(await fs.readFile(fp, "utf8"), "fake-ffprobe");
      return { ffmpeg: fm, ffprobe: fp, version: "test" };
    };
    const result = await installArchive(archive, root, { validate });
    assert(path.isAbsolute(result.ffmpeg));
    // Every executable is checked in its final location, never renamed after execution.
    assert.match(path.basename(path.dirname(result.ffmpeg)), /^9\.0\.2-/);
    const originalRename = fs.rename;
    try {
      fs.rename = async () => {
        throw Object.assign(Error("Windows executable directory locked"), { code: "EPERM" });
      };
      const fresh = await installArchive(archive, path.join(root, "locked-windows"), { validate });
      await validate(fresh.ffmpeg, fresh.ffprobe);
      const reused = await installArchive(archive, path.join(root, "locked-windows"), { validate });
      assert.equal(reused.ffmpeg, fresh.ffmpeg);
    } finally {
      fs.rename = originalRename;
    }
    const cached = await ensureTools({ root: path.join(root, "locked-windows"), platform: "win32", env: {}, validate });
    assert.equal(cached.source, "cache");
    const saved = await ensureTools({ root: path.join(root, "locked-windows"), platform: "win32", env: {}, validate });
    assert.equal(saved.source, "saved");
    await assert.rejects(() => fs.stat(path.join(root, "outside.txt")));
    const broken = new AdmZip();
    broken.addFile("bad/ffmpeg.exe", Buffer.from("broken"));
    const bad = path.join(root, "bad.zip");
    broken.writeZip(bad);
    await assert.rejects(
      () => installArchive(bad, path.join(root, "bad-tools"), { validate }),
      /FFmpeg\/FFprobe/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
