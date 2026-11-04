export type Settings = {
  speed: number;
  brightness: number;
  contrast: number;
  saturation: number;
  zoom: number;
  volume: number;
  fps: number;
  resolution: "original" | "720" | "1080";
  metadata: "strip" | "keep";
  title: string;
  overlay: string;
  overlaySize: number;
  overlayX: number;
  overlayY: number;
  subtitles: string;
  seed: number;
  auto: boolean;
  variations: number;
  speedVariation: number;
  colorVariation: number;
  zoomVariation: number;
  mute: boolean;
  format: "mp4" | "webm";
  flip: boolean;
  hue: number;
  noise: number;
  vignette: boolean;
  strength: "light" | "medium" | "strong";
  durationVariation: boolean;
  frameVariation: boolean;
  deltaMin: number;
  deltaMax: number;
  frameMin: number;
  frameMax: number;
  cropX: number;
  cropY: number;
  adaptive: boolean;
  crf: number;
  audioNormalize: boolean;
  fadeAudio: boolean;
  hook: string;
  hookSeconds: number;
  analysis: boolean;
  qualityRetry: boolean;
  analysisSamples: number;
};
export const defaults: Settings = {
  speed: 1,
  brightness: 0,
  contrast: 1,
  saturation: 1,
  zoom: 1,
  volume: 1,
  fps: 30,
  resolution: "original",
  metadata: "strip",
  title: "",
  overlay: "",
  overlaySize: 38,
  overlayX: 50,
  overlayY: 85,
  subtitles: "",
  seed: 12345,
  auto: false,
  variations: 1,
  speedVariation: 0.015,
  colorVariation: 0.03,
  zoomVariation: 0.015,
  mute: false,
  format: "mp4",
  flip: false,
  hue: 0,
  noise: 0,
  vignette: false,
  strength: "medium",
  durationVariation: false,
  frameVariation: false,
  deltaMin: 0.2,
  deltaMax: 0.9,
  frameMin: 9,
  frameMax: 18,
  cropX: 50,
  cropY: 50,
  adaptive: true,
  crf: 21,
  audioNormalize: false,
  fadeAudio: false,
  hook: "",
  hookSeconds: 3,
  analysis: true,
  qualityRetry: true,
  analysisSamples: 5,
};
export const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
export function validateSettings(value: unknown): Settings {
  if (!value || typeof value !== "object")
    throw Error("Настройки должны быть объектом");
  const raw = value as Record<string, unknown>;
  const s = { ...defaults };
  const ranges: Record<string, [number, number]> = {
    speed: [0.85, 1.25],
    brightness: [-0.15, 0.15],
    contrast: [0.85, 1.15],
    saturation: [0.8, 1.2],
    zoom: [1, 1.12],
    volume: [0, 2],
    fps: [24, 60],
    overlaySize: [16, 96],
    overlayX: [5, 95],
    overlayY: [5, 95],
    seed: [0, 4294967295],
    variations: [1, 50],
    speedVariation: [0, 0.1],
    colorVariation: [0, 0.1],
    zoomVariation: [0, 0.05],
    hue: [-25, 25],
    noise: [0, 12],
    deltaMin: [0.2, 0.9],
    deltaMax: [0.2, 0.9],
    frameMin: [6, 27],
    frameMax: [6, 27],
    cropX: [0, 100],
    cropY: [0, 100],
    crf: [18, 28],
    hookSeconds: [0.5, 10],
    analysisSamples: [3, 9],
  };
  const enums: Record<string, string[]> = {
    resolution: ["original", "720", "1080"],
    metadata: ["strip", "keep"],
    format: ["mp4", "webm"],
    strength: ["light", "medium", "strong"],
  };
  for (const key of Object.keys(defaults) as (keyof Settings)[]) {
    if (raw[key] === undefined) continue;
    const v = raw[key];
    if (ranges[key]) {
      const [lo, hi] = ranges[key];
      if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi)
        throw Error("Недопустимое значение: " + key);
    } else if (enums[key]) {
      if (!enums[key].includes(String(v)))
        throw Error("Недопустимое значение: " + key);
    } else if (
      typeof v !== typeof defaults[key] ||
      (typeof v === "string" && v.length > (key === "subtitles" ? 50000 : 500))
    )
      throw Error("Недопустимое значение: " + key);
    Object.assign(s, { [key]: v });
  }
  if (
    ![24, 25, 30, 60].includes(s.fps) ||
    ![s.variations, s.frameMin, s.frameMax, s.analysisSamples].every(
      Number.isInteger,
    ) ||
    s.deltaMin > s.deltaMax ||
    s.frameMin > s.frameMax
  )
    throw Error("Проверьте FPS, количество вариантов и границы диапазонов");
  return s;
}
export function generator(seed: number) {
  let x = seed >>> 0 || 0x9e3779b9;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}
export function randomFor(s: Settings, index: number): Settings {
  if (!s.auto) return { ...s };
  const rnd = generator(s.seed + index * 2654435761),
    centered = () => rnd() * 2 - 1;
  const f = s.strength === "light" ? 0.5 : s.strength === "strong" ? 1.2 : 1;
  return {
    ...s,
    speed: clamp(s.speed + centered() * s.speedVariation * f, 0.85, 1.25),
    brightness: clamp(
      s.brightness + (centered() * s.colorVariation * f) / 3,
      -0.08,
      0.08,
    ),
    contrast: clamp(s.contrast + centered() * s.colorVariation * f, 0.9, 1.1),
    saturation: clamp(
      s.saturation + centered() * s.colorVariation * f,
      0.9,
      1.1,
    ),
    zoom: clamp(s.zoom + rnd() * s.zoomVariation * f, 1, 1.08),
    hue: clamp(s.hue + centered() * 3 * f, -12, 12),
    noise: clamp(s.noise + rnd() * f, 0, 5),
  };
}
export type Probe = {
  streams: Array<{
    codec_type: string;
    codec_name?: string;
    profile?: string;
    pix_fmt?: string;
    sample_rate?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    nb_read_frames?: string;
    nb_frames?: string;
    duration?: string;
    bit_rate?: string;
    tags?: Record<string, string>;
    disposition?: { attached_pic?: number };
    side_data_list?: Array<{ rotation?: number }>;
    color_transfer?: string;
  }>;
  format: {
    duration: string;
    bit_rate?: string;
    tags?: Record<string, string>;
  };
};
export function videoStream(p: Probe) {
  const v = p.streams.find(
    (x) => x.codec_type === "video" && !x.disposition?.attached_pic,
  );
  if (!v) throw Error("В файле нет видеопотока");
  return v;
}
export function displaySize(v: Probe["streams"][number]) {
  const rotation = Number(
    v.side_data_list?.find((x) => x.rotation !== undefined)?.rotation ??
      v.tags?.rotate ??
      0,
  );
  return Math.abs(rotation) % 180 === 90
    ? { width: v.height!, height: v.width! }
    : { width: v.width!, height: v.height! };
}
export function ratio(v?: string) {
  const [a, b = 1] = (v || "0").split("/").map(Number);
  return b ? a / b : 0;
}
export type Timeline = {
  baseFrames: number;
  frames: number;
  deltaFrames: number;
  duration: number;
  baseDuration: number;
  deltaSeconds: number;
};
export function timeline(
  s: Settings,
  duration: number,
  index: number,
): Timeline {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 600)
    throw Error("Поддерживаются видео длительностью от 0 до 600 секунд");
  const baseFrames = Math.max(1, Math.round((duration / s.speed) * s.fps)),
    baseDuration = baseFrames / s.fps;
  const rnd = generator(s.seed + index * 7919);
  let lo = s.frameVariation ? s.frameMin : 1,
    hi = s.frameVariation ? s.frameMax : Math.ceil(s.deltaMax * s.fps);
  if (s.durationVariation) {
    lo = Math.max(lo, Math.ceil(s.deltaMin * s.fps - 1e-8));
    hi = Math.min(hi, Math.floor(s.deltaMax * s.fps + 1e-8));
  }
  let delta = 0;
  if (s.frameVariation || s.durationVariation) {
    if (lo > hi)
      throw Error(
        "Диапазоны длительности и кадров не пересекаются при выбранном FPS",
      );
    delta = (lo + Math.floor(rnd() * (hi - lo + 1))) * (rnd() < 0.5 ? -1 : 1);
    if (baseFrames + delta < Math.max(2, Math.ceil(0.25 * s.fps)))
      delta = Math.abs(delta);
  }
  const frames = baseFrames + delta;
  return {
    baseFrames,
    frames,
    deltaFrames: delta,
    duration: frames / s.fps,
    baseDuration,
    deltaSeconds: delta / s.fps,
  };
}
export type Cue = { start: number; end: number; text: string };
export function parseSrt(text: string): Cue[] {
  return text
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .flatMap((block) => {
      const lines = block.split("\n");
      const at = lines.findIndex((l) => l.includes("-->"));
      if (at < 0) return [];
      const m = lines[at].match(
        /(?:(\d{2}):)?(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(?:(\d{2}):)?(\d{2}):(\d{2})[,.](\d{3})/,
      );
      if (!m) return [];
      const start =
          Number(m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000,
        end = Number(m[5] || 0) * 3600 + +m[6] * 60 + +m[7] + +m[8] / 1000;
      const value = lines
        .slice(at + 1)
        .join("\n")
        .trim();
      if (end <= start || !value) return [];
      return [{ start, end, text: value }];
    });
}
export function generateSrt(text: string, duration: number) {
  const lines = text
    .split(/\n+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 80);
  const stamp = (t: number) => {
    const ms = Math.round(t * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  return lines
    .map(
      (t, i) =>
        `${i + 1}\n${stamp((duration * i) / lines.length)} --> ${stamp((duration * (i + 1)) / lines.length)}\n${t}`,
    )
    .join("\n\n");
}
export function dimensions(s: Settings, w: number, h: number) {
  const width = s.resolution === "original" ? w : Number(s.resolution);
  return {
    width: Math.ceil(width / 2) * 2,
    height: Math.ceil((h * width) / w / 2) * 2,
  };
}
export function geometry(s: Settings, w: number, h: number) {
  const d = dimensions(s, w, h);
  const f: string[] = [];
  if (s.zoom > 1)
    f.push(
      `crop=trunc(iw/${s.zoom.toFixed(6)}/2)*2:trunc(ih/${s.zoom.toFixed(6)}/2)*2:(iw-out_w)*${s.cropX / 100}:(ih-out_h)*${s.cropY / 100}`,
    );
  if (s.flip) f.push("hflip");
  f.push(`scale=${d.width}:${d.height}:flags=lanczos`, "setsar=1");
  return f;
}
export function buildFilters(s: Settings, w: number, h: number, t?: Timeline) {
  const f = [
    `setpts=(PTS-STARTPTS)/${s.speed.toFixed(7)}`,
    ...geometry(s, w, h),
  ];
  if (s.brightness !== 0 || s.contrast !== 1 || s.saturation !== 1)
    f.push(
      `eq=brightness=${s.brightness.toFixed(5)}:contrast=${s.contrast.toFixed(5)}:saturation=${s.saturation.toFixed(5)}`,
    );
  if (s.hue) f.push(`hue=h=${s.hue.toFixed(3)}`);
  if (s.noise)
    f.push(`noise=alls=${s.noise.toFixed(3)}:allf=t:all_seed=${s.seed >>> 0}`);
  if (s.vignette) f.push("vignette=PI/5");
  f.push(`fps=${s.fps}`);
  if (t)
    f.push(
      `tpad=stop_mode=clone:stop_duration=${Math.max(1, t.deltaSeconds + 1).toFixed(7)}`,
      `trim=end_frame=${t.frames}`,
      "setpts=PTS-STARTPTS",
    );
  return f.join(",");
}
export function encoding(s: Settings, p: Probe) {
  const v = videoStream(p),
    bpp =
      Number(v.bit_rate || p.format.bit_rate || 0) /
      ((v.width || 1) * (v.height || 1) * (ratio(v.avg_frame_rate) || s.fps));
  return {
    crf: s.adaptive
      ? bpp > 0 && bpp < 0.08
        ? 19
        : (v.width || 0) >= 1920
          ? 20
          : 21
      : s.crf,
    preset: "veryfast",
  };
}
export function buildArgs(
  input: string,
  output: string,
  s: Settings,
  w: number,
  h: number,
  hasAudio: boolean,
  t: Timeline,
  p: Probe,
  overlays: { path: string; start: number; end: number }[] = [],
) {
  const args = ["-i", input];
  for (const o of overlays) args.push("-i", o.path);
  if (overlays.length) {
    let graph = `[0:v]${buildFilters(s, w, h, t)}[base0];`;
    overlays.forEach((o, i) => {
      graph += `[base${i}][${i + 1}:v]overlay=0:0:eof_action=repeat:enable='between(t,${o.start.toFixed(4)},${o.end.toFixed(4)})'[base${i + 1}];`;
    });
    args.push(
      "-filter_complex",
      graph.slice(0, -1),
      "-map",
      `[base${overlays.length}]`,
    );
  } else args.push("-vf", buildFilters(s, w, h, t), "-map", "0:v:0");
  if (hasAudio && !s.mute) args.push("-map", "0:a:0");
  const enc = encoding(s, p);
  if (s.format === "mp4")
    args.push(
      "-c:v",
      "libx264",
      "-preset",
      enc.preset,
      "-crf",
      String(enc.crf),
      "-pix_fmt",
      "yuv420p",
      "-profile:v",
      "high",
      "-tag:v",
      "avc1",
    );
  else
    args.push(
      "-c:v",
      "libvpx-vp9",
      "-deadline",
      "realtime",
      "-cpu-used",
      "8",
      "-b:v",
      "0",
      "-crf",
      "30",
    );
  if (hasAudio && !s.mute) {
    const af = [
      `atempo=${s.speed.toFixed(7)}`,
      `volume=${s.volume.toFixed(5)}`,
    ];
    if (s.audioNormalize) af.push("loudnorm=I=-16:TP=-1.5:LRA=11");
    if (s.fadeAudio)
      af.push(
        "afade=t=in:d=0.15",
        `afade=t=out:st=${Math.max(0, t.duration - 0.2)}:d=0.2`,
      );
    af.push(
      "apad",
      `atrim=duration=${t.duration.toFixed(7)}`,
      "asetpts=PTS-STARTPTS",
    );
    args.push(
      "-af",
      af.join(","),
      "-c:a",
      s.format === "mp4" ? "aac" : "libopus",
      "-ar",
      "48000",
      "-b:a",
      "128k",
    );
    if (s.format === "mp4") args.push("-profile:a", "aac_low");
  } else args.push("-an");
  // trim=end_frame already bounds the video. In FFmpeg.wasm an output -frames:v
  // also stops the muxer before padded/filtered audio reaches its end.
  args.push("-t", t.duration.toFixed(7));
  if (s.metadata === "strip")
    args.push(
      "-map_metadata",
      "-1",
      "-map_chapters",
      "-1",
      "-metadata",
      "encoder=",
      "-metadata:s:v",
      "encoder=",
      "-metadata",
      "comment=",
    );
  if (s.title.trim() && s.metadata === "keep")
    args.push("-metadata", `title=${s.title.trim()}`);
  if (s.format === "mp4") args.push("-movflags", "+faststart");
  args.push("-y", output);
  return args;
}
export function soften(s: Settings): Settings {
  return {
    ...s,
    brightness: s.brightness * 0.5,
    contrast: 1 + (s.contrast - 1) * 0.5,
    saturation: 1 + (s.saturation - 1) * 0.5,
    hue: s.hue * 0.5,
    noise: s.noise * 0.5,
    vignette: false,
  };
}
