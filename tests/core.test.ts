import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import {
  defaults,
  validateSettings,
  randomFor,
  timeline,
  buildArgs,
  generateSrt,
  parseSrt,
  type Probe,
} from "../src/lib/processing";
import { cleanMp4, fastStart, atoms } from "../src/lib/mp4";
import { compareFrames, similarityNotice } from "../src/lib/metrics";
import {
  applyAutoPreset,
  applyVisualPreset,
  hasVisualEffects,
} from "../src/lib/visual-presets";
import { createZip, csv } from "../src/lib/export";
const exec = promisify(execFile);
async function probe(file: string): Promise<Probe> {
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
test("settings validate imports; deterministic random plans and intersecting frame/duration ranges", () => {
  assert.throws(() => validateSettings({ speed: NaN }));
  assert.throws(() => validateSettings({ variations: 51 }));
  assert.throws(() => validateSettings({ fps: 29 }));
  assert.throws(() => validateSettings({ auto: "yes" }));
  assert.throws(() => validateSettings({ frameMin: 18, frameMax: 9 }));
  assert.deepEqual(
    randomFor({ ...defaults, auto: true }, 5),
    randomFor({ ...defaults, auto: true }, 5),
  );
  assert.notDeepEqual(
    randomFor({ ...defaults, auto: true }, 5),
    randomFor({ ...defaults, auto: true }, 6),
  );
  for (let i = 0; i < 50; i++) {
    const t = timeline(
      { ...defaults, durationVariation: true, frameVariation: true },
      23.8,
      i,
    );
    assert(Math.abs(t.deltaFrames) >= 9 && Math.abs(t.deltaFrames) <= 18);
    assert(Math.abs(t.deltaSeconds) >= 0.2 && Math.abs(t.deltaSeconds) <= 0.9);
    assert.equal(t.frames, 714 + t.deltaFrames);
    assert.equal(t.duration, t.frames / 30);
  }
  assert.throws(
    () =>
      timeline(
        {
          ...defaults,
          fps: 60,
          frameVariation: true,
          frameMin: 6,
          frameMax: 8,
          durationVariation: true,
        },
        2,
        1,
      ),
    /не пересекаются/,
  );
});
test("real RGB metrics: exact MAE and identity; local SSIM and perceptual hash respond to image changes", () => {
  const a = new Uint8Array(32 * 32 * 3).fill(100),
    b = new Uint8Array(a.length).fill(107);
  const same = compareFrames(a, a, 32, 32);
  assert.equal(same.mae, 0);
  assert.equal(same.ssim, 1);
  assert.equal(same.hashDistance, 0);
  assert(similarityNotice(same));
  assert.equal(hasVisualEffects(defaults), false);
  const preset = applyVisualPreset(
    { ...defaults, mute: true, overlay: "Мой текст" },
    "vivid",
  );
  assert(hasVisualEffects(preset));
  assert.equal(preset.mute, true);
  assert.equal(preset.overlay, "Мой текст");
  const changed = compareFrames(a, b, 32, 32);
  assert.equal(changed.mae, 7);
  assert(changed.ssim < 1 && changed.ssim > 0.9);
  assert.equal(changed.heat[0], 56);
  const c = new Uint8Array(a.length);
  for (let i = 0; i < c.length; i++) c[i] = (i * 37) % 255;
  assert(compareFrames(a, c, 32, 32).hashDistance > 0);
  assert.throws(() => compareFrames(a, b, 64, 32));
});
test("subtitle generator round trip, WebVTT timing, and invalid cues", () => {
  const cues = parseSrt(generateSrt("Первая строка\nВторая строка", 10));
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 0);
  assert.equal(cues[1].end, 10);
  assert.equal(parseSrt("WEBVTT\n\n00:00.000 --> 00:01.000\nHello").length, 1);
  assert.equal(parseSrt("1\n00:00:03,000 --> 00:00:01,000\nwrong").length, 0);
});
test("ZIP contains real blobs and valid CRCs, UTF-8 names; CSV prevents spreadsheet formula injection", async () => {
  const blob = await createZip(
    [
      { name: "видео.txt", blob: new Blob(["hello"]) },
      { name: "report.json", blob: new Blob(['{"ok":true}']) },
    ],
    () => {},
    () => false,
  );
  const zip = await JSZip.loadAsync(await blob.arrayBuffer(), {
    checkCRC32: true,
  });
  assert.equal(await zip.file("видео.txt")!.async("string"), "hello");
  assert.equal(
    JSON.parse(await zip.file("report.json")!.async("string")).ok,
    true,
  );
  assert(csv([{ sourceName: "=1+1" } as never]).includes("'=1+1"));
  await assert.rejects(
    () =>
      createZip(
        [{ name: "x", blob: new Blob(["x"]) }],
        () => {},
        () => true,
      ),
    /отменено/,
  );
});
test("native video exports: timeline frames, AAC sync, crop/color/audio/text filters, metadata and full decode", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vus-tests-"));
  try {
    const input = path.join(dir, "input.mp4");
    await exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=160x96:r=30",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=600:sample_rate=48000",
      "-t",
      "2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-metadata",
      "comment=REMOVE_ME",
      "-metadata",
      "title=REMOVE_TITLE",
      "-movflags",
      "+faststart",
      input,
    ]);
    const p = await probe(input);
    const layer = path.join(dir, "layer.png");
    await exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=white:s=160x96",
      "-frames:v",
      "1",
      "-threads",
      "1",
      layer,
    ]);
    const cases = [
      defaults,
      { ...defaults, durationVariation: true },
      { ...defaults, frameVariation: true },
      {
        ...defaults,
        frameVariation: true,
        durationVariation: true,
        speed: 1.08,
        zoom: 1.04,
        brightness: 0.02,
        contrast: 1.03,
        saturation: 0.98,
        noise: 1,
        hue: 2,
        flip: true,
        audioNormalize: true,
        fadeAudio: true,
      },
      { ...defaults, mute: true },
      applyVisualPreset(defaults, "natural"),
      applyVisualPreset(defaults, "vivid"),
      randomFor(applyAutoPreset(defaults), 4),
    ];
    for (let i = 0; i < cases.length; i++) {
      const s = cases[i],
        t = timeline(s, 2, i),
        output = path.join(dir, `out${i}.mp4`);
      await exec(
        "ffmpeg",
        [
          "-v",
          "error",
          ...buildArgs(
            input,
            output,
            s,
            160,
            96,
            true,
            t,
            p,
            i === 3 ? [{ path: layer, start: 0.1, end: 0.3 }] : [],
          ),
        ],
        { maxBuffer: 1024 * 1024 },
      );
      const raw = new Uint8Array(await readFile(output));
      const length = raw.length;
      assert(fastStart(raw));
      const removed = cleanMp4(raw);
      assert(removed.includes("udta"));
      assert.equal(raw.length, length);
      assert(fastStart(raw));
      await writeFile(output, raw);
      const result = await probe(output),
        v = result.streams.find((x) => x.codec_type === "video")!;
      assert.equal(Number(v.nb_read_frames), t.frames);
      assert(Math.abs(Number(v.duration) - t.duration) < 0.04);
      assert.equal(v.codec_name, "h264");
      assert.equal(v.pix_fmt, "yuv420p");
      assert.equal(v.width, 160);
      assert.equal(v.height, 96);
      assert.equal(result.format.tags?.encoder, undefined);
      assert.equal(result.format.tags?.comment, undefined);
      assert.equal(v.tags?.encoder, undefined);
      const a = result.streams.find((x) => x.codec_type === "audio");
      if (s.mute) assert.equal(a, undefined);
      else {
        assert.equal(a?.codec_name, "aac");
        assert.equal(a?.profile, "LC");
        assert(Math.abs(Number(a?.duration) - t.duration) < 0.15);
      }
      await exec("ffmpeg", [
        "-v",
        "error",
        "-xerror",
        "-i",
        output,
        "-map",
        "0:v",
        "-map",
        "0:a?",
        "-f",
        "null",
        "-",
      ]);
    }
    const rgb = async (file: string) =>
      new Uint8Array(
        (
          await exec(
            "ffmpeg",
            [
              "-v",
              "error",
              "-ss",
              "0.5",
              "-i",
              file,
              "-frames:v",
              "1",
              "-threads",
              "1",
              "-pix_fmt",
              "rgb24",
              "-f",
              "rawvideo",
              "pipe:1",
            ],
            { encoding: "buffer", maxBuffer: 1024 * 1024 },
          )
        ).stdout,
      );
    const reference = await rgb(input);
    const neutral = compareFrames(
      reference,
      await rgb(path.join(dir, "out0.mp4")),
      160,
      96,
    );
    const natural = compareFrames(
      reference,
      await rgb(path.join(dir, "out5.mp4")),
      160,
      96,
    );
    const vivid = compareFrames(
      reference,
      await rgb(path.join(dir, "out6.mp4")),
      160,
      96,
    );
    assert(
      natural.mae > neutral.mae + 1,
      "natural profile must change decoded pixels",
    );
    assert(
      vivid.mae > natural.mae,
      "vivid profile must apply its stronger crop/color settings",
    );
    assert(vivid.ssim < neutral.ssim);
    assert.equal(similarityNotice(vivid), null);
    const silent = path.join(dir, "silent.mp4");
    await exec("ffmpeg", [
      "-v",
      "error",
      "-i",
      input,
      "-an",
      "-c:v",
      "copy",
      silent,
    ]);
    const t = timeline(defaults, 2, 8),
      out = path.join(dir, "silent-result.mp4");
    await exec("ffmpeg", [
      "-v",
      "error",
      ...buildArgs(
        silent,
        out,
        defaults,
        160,
        96,
        false,
        t,
        await probe(silent),
      ),
    ]);
    assert.equal(
      (await probe(out)).streams.some((s) => s.codec_type === "audio"),
      false,
    );
    assert.throws(
      () => atoms(new Uint8Array([0, 0, 0, 20, 109, 111, 111, 118])),
      /Повреждена/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("queue plans 50 independent variants, enforces total cap, and does not reuse indices after deletion", async () => {
  const { createPlan } = await import("../src/lib/queue");
  const source = {
    id: "source",
    file: { name: "clip.mp4" },
    width: 1080,
    height: 1920,
  };
  const tasks = createPlan(
    [source],
    { ...defaults, variations: 50, auto: true },
    [],
    false,
  );
  assert.equal(tasks.length, 50);
  assert.equal(new Set(tasks.map((t) => t.id)).size, 50);
  assert.equal(new Set(tasks.map((t) => t.index)).size, 50);
  assert.notDeepEqual(tasks[0].settings, tasks[1].settings);
  tasks[0].settings.speed = 1.2;
  assert.notEqual(tasks[1].settings.speed, 1.2);
  assert.throws(
    () =>
      createPlan(
        [source],
        { ...defaults, variations: 2 },
        tasks.slice(0, 49),
        false,
      ),
    /до 50/,
  );
  const retained = [tasks[5], tasks[12]];
  const next = createPlan([source], defaults, retained, true);
  assert.equal(next[0].index, 13);
  assert.equal(next[0].settings.resolution, "720");
});

test("auto profile preserves editing decisions and requests per-source analysis", () => {
  const input = {
    ...defaults,
    overlay: "My caption",
    mute: true,
    volume: 0.7,
    fps: 60,
  };
  const preset = applyAutoPreset(input);
  assert.equal(input.speed, 1);
  for (let i = 0; i < 50; i++) {
    const s = validateSettings(randomFor(preset, i));
    assert.equal(s.speed, input.speed);
    assert.equal(s.autoAnalyze, true);
    assert.equal(s.zoom, input.zoom);
    assert.equal(s.overlay, input.overlay);
    assert.equal(s.mute, true);
    assert.equal(s.volume, 0.7);
    assert.equal(s.fps, 60);
    assert.equal(s.analysisSamples, 9);
    const t = timeline(s, 60, i);
    assert.equal(t.deltaFrames, 0);
    assert.equal(t.duration, 60);
  }
  const captions = {
    ...input,
    speed: 0.95,
    subtitles: "1\n00:00:00,000 --> 00:00:01,000\nText",
  };
  assert.equal(randomFor(applyAutoPreset(captions), 4).speed, 0.95);
  assert.equal(applyAutoPreset(captions).subtitles, captions.subtitles);
});
