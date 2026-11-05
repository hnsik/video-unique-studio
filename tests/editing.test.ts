import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  defaults,
  buildArgs,
  timeline,
  validateSettings,
  type Probe,
} from "../src/lib/processing";
import {
  editedDuration,
  parseSegments,
  parseZoom,
  originalTime,
} from "../src/lib/editing";
import { selectAutoSettings } from "../src/lib/auto-analysis";
import { applyAutoPreset } from "../src/lib/visual-presets";
const exec = promisify(execFile);
test("auto analyzes pixels, selects different exposure and limits additional clipping", () => {
  const dark = new Uint8Array(96 * 64 * 3).fill(45),
    light = new Uint8Array(dark.length).fill(215);
  const a = selectAutoSettings(applyAutoPreset(defaults), dark),
    b = selectAutoSettings(applyAutoPreset(defaults), light);
  assert(a.settings.brightness > 0);
  assert(b.settings.brightness < 0);
  for (const r of [a, b]) {
    assert.equal(r.decision.candidates, 45);
    assert(
      r.decision.predicted.clippedLight <=
        r.decision.before.clippedLight + 0.005,
    );
    assert(
      r.decision.predicted.clippedDark <= r.decision.before.clippedDark + 0.005,
    );
  }
  const extremes = new Uint8Array(dark.length);
  extremes.fill(255, extremes.length / 2);
  const c = selectAutoSettings(defaults, extremes);
  assert(Number.isFinite(c.settings.contrast));
});
test("edit validation rejects injected filters, unordered keys and out-of-bounds segments", () => {
  assert.throws(() => parseSegments("0 1;movie=/secret"));
  assert.throws(() => parseSegments("0 10", 3));
  assert.throws(() => parseZoom("2 1\n1 1.1"));
  assert.throws(() => validateSettings({ ...defaults, zoomKeys: "0 9" }));
  assert.equal(editedDuration("2 3\n0 1", 3), 2);
  assert.equal(originalTime("2 3\n0 1", 0.5), 2.5);
  assert.equal(originalTime("2 3\n0 1", 1.5), 0.5);
});
test("native montage preserves chosen scene order, keyframe zoom, narration and audio duration", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "vus-edit-"));
  try {
    await exec(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=red:s=96x64:r=30:d=1",
        "-f",
        "lavfi",
        "-i",
        "color=blue:s=96x64:r=30:d=1",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=2",
        "-filter_complex",
        "[0:v][1:v]concat=n=2:v=1:a=0[v]",
        "-map",
        "[v]",
        "-map",
        "2:a",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "-y",
        "input.mp4",
      ],
      { cwd: dir },
    );
    await exec(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=880:duration=0.4",
        "-f",
        "wav",
        "voice",
      ],
      { cwd: dir },
    );
    const probe = async (file: string): Promise<Probe> =>
      JSON.parse(
        (
          await exec(
            "ffprobe",
            [
              "-v",
              "error",
              "-count_frames",
              "-show_streams",
              "-show_format",
              "-of",
              "json",
              file,
            ],
            { cwd: dir },
          )
        ).stdout,
      );
    const p = await probe("input.mp4");
    for (const mute of [false, true]) {
      const s = {
        ...defaults,
        segments: "1 2\n0 1",
        zoomKeys: "0 1\n0.5 1.1\n1.5 1",
        voiceId: "test",
        voiceStart: 0.2,
        mute,
      };
      const t = timeline(s, editedDuration(s.segments, 2), 0);
      const args = buildArgs("input.mp4", "out.mp4", s, 96, 64, true, t, p);
      const { validateArgs } = await import("../desktop/lib/native-engine.cjs");
      validateArgs("ffmpeg", args);
      await exec("ffmpeg", ["-v", "error", ...args], { cwd: dir });
      const output = await probe("out.mp4"),
        v = output.streams.find((x) => x.codec_type === "video")!,
        a = output.streams.find((x) => x.codec_type === "audio")!;
      assert.equal(Number(v.nb_read_frames), 60);
      assert.equal(Number(a.duration), 2);
      const pixel = async (time: string) =>
        (
          await exec(
            "ffmpeg",
            [
              "-v",
              "error",
              "-ss",
              time,
              "-i",
              "out.mp4",
              "-vf",
              "scale=1:1",
              "-frames:v",
              "1",
              "-pix_fmt",
              "rgb24",
              "-f",
              "rawvideo",
              "pipe:1",
            ],
            { cwd: dir, encoding: "buffer" },
          )
        ).stdout;
      const first = await pixel("0.2"),
        second = await pixel("1.2");
      assert(first[2] > first[0] + 100);
      assert(second[0] > second[2] + 100);
      await exec(
        "ffmpeg",
        ["-v", "error", "-xerror", "-i", "out.mp4", "-f", "null", "-"],
        { cwd: dir },
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
