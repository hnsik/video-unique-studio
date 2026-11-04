import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  defaults,
  timeline,
  buildArgs,
  type Probe,
  type Settings,
} from "../src/lib/processing";
const exec = promisify(execFile),
  require = createRequire(import.meta.url);
async function nativeProbe(file: string): Promise<Probe> {
  return JSON.parse(
    (
      await exec("ffprobe", [
        "-v",
        "error",
        "-count_frames",
        "-show_format",
        "-show_streams",
        "-of",
        "json",
        file,
      ])
    ).stdout,
  );
}

test("native and WASM exports finish padded audio without truncation: short/long tracks, offsets, tempo, frame changes and normalization", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vus-audio-sync-"));
  const previous = Object.getOwnPropertyDescriptor(globalThis, "self");
  Object.defineProperty(globalThis, "self", {
    value: { location: { href: "file:///ffmpeg-core.js" } },
    configurable: true,
  });
  try {
    const factory = require("../node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js");
    const core = await factory({
      wasmBinary: await readFile(
        "node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm",
      ),
    });
    const logs: string[] = [];
    core.setLogger(({ message }: { message: string }) => {
      logs.push(message);
      if (logs.length > 20) logs.shift();
    });
    const probe = (): Probe => {
      core.ffprobe(
        "-v",
        "error",
        "-count_frames",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        "output.mp4",
        "-o",
        "probe.json",
      );
      const code = core.ret;
      core.reset();
      assert([0, -1].includes(code));
      return JSON.parse(core.FS.readFile("probe.json", { encoding: "utf8" }));
    };
    const layer = path.join(dir, "layer.png");
    await exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=white:s=96x64",
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-y",
      layer,
    ]);
    core.FS.writeFile("layer.png", new Uint8Array(await readFile(layer)));
    const fixtures = [
      { video: 6, audio: 3, offset: 0, rate: 44100 },
      { video: 6, audio: 10, offset: 0, rate: 48000 },
      { video: 6, audio: 4, offset: 0.7, rate: 44100 },
      { video: 60, audio: 59, offset: 0, rate: 44100 },
    ];
    for (const [i, f] of fixtures.entries()) {
      const input = path.join(dir, `input${i}.mp4`);
      await exec("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `testsrc2=s=96x64:r=30:d=${f.video}`,
        "-itsoffset",
        String(f.offset),
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=600:sample_rate=${f.rate}:duration=${f.audio}`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-y",
        input,
      ]);
      const p = await nativeProbe(input);
      core.FS.writeFile("input", new Uint8Array(await readFile(input)));
      const configs: Settings[] = [
        defaults,
        {
          ...defaults,
          speed: 1.09,
          durationVariation: true,
          frameVariation: true,
        },
        {
          ...defaults,
          speed: 0.91,
          frameVariation: true,
          audioNormalize: true,
          fadeAudio: true,
        },
      ];
      for (const [j, s] of configs.entries()) {
        const t = timeline(s, f.video, i * configs.length + j);
        for (const kind of ["native", "wasm"]) {
          let output: Probe;
          if (kind === "native") {
            const out = path.join(dir, "out.mp4");
            await exec("ffmpeg", [
              "-v",
              "error",
              ...buildArgs(
                input,
                out,
                s,
                96,
                64,
                true,
                t,
                p,
                j === 2 ? [{ path: layer, start: 0.1, end: 0.4 }] : [],
              ),
            ]);
            output = await nativeProbe(out);
          } else {
            core.exec(
              ...buildArgs(
                "input",
                "output.mp4",
                s,
                96,
                64,
                true,
                t,
                p,
                j === 2 ? [{ path: "layer.png", start: 0.1, end: 0.4 }] : [],
              ),
            );
            const code = core.ret;
            core.reset();
            assert.equal(code, 0, logs.join("\n"));
            output = probe();
            core.exec(
              "-v",
              "error",
              "-xerror",
              "-i",
              "output.mp4",
              "-f",
              "null",
              "-",
            );
            const decode = core.ret;
            core.reset();
            assert.equal(decode, 0);
          }
          const v = output.streams.find((x) => x.codec_type === "video")!,
            a = output.streams.find((x) => x.codec_type === "audio")!;
          assert.equal(
            Number(v.nb_read_frames),
            t.frames,
            `${kind}: frame count`,
          );
          assert(
            Math.abs(Number(v.duration) - t.duration) < 0.002,
            `${kind}: video duration`,
          );
          assert.equal(a.codec_name, "aac");
          assert.equal(a.profile, "LC");
          assert(
            Math.abs(Number(a.duration) - t.duration) < 0.04,
            `${kind}: audio ${a.duration} vs ${t.duration}; fixture ${i}, config ${j}`,
          );
        }
      }
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "self", previous);
    else Reflect.deleteProperty(globalThis, "self");
    await rm(dir, { recursive: true, force: true });
  }
});
