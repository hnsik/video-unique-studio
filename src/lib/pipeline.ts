import { FFmpeg } from "@ffmpeg/ffmpeg";
import {
  buildArgs,
  dimensions,
  displaySize,
  geometry,
  parseSrt,
  ratio,
  soften,
  timeline,
  videoStream,
  type Settings,
  type Probe,
  type Timeline,
} from "./processing";
import { cleanMp4, fastStart } from "./mp4";
import type { FrameMetrics } from "./metrics";
export type Sample = {
  time: number;
  sourceTime: number;
  mae: number;
  ssim: number;
  hashDistance: number;
  hashA: string;
  hashB: string;
};
export type Analysis = {
  mae: number;
  ssim: number;
  hashDistance: number;
  samples: Sample[];
  width: number;
  height: number;
  heatmap: string;
  targetMae: [number, number];
  withinTarget: boolean;
};
export type Report = {
  version: string;
  sourceName: string;
  outputName: string;
  settings: Settings;
  timeline: Timeline;
  source: Probe;
  output: Probe;
  analysis: Analysis | null;
  sourceSha256: string;
  outputSha256: string;
  metadata: {
    removed: string[];
    remaining: Record<string, string>;
    warnings: string[];
  };
  warnings: string[];
  checks: {
    decoded: boolean;
    browserPlayback: boolean;
    frames: number;
    expectedFrames: number;
    audio: boolean;
    fastStart: boolean | null;
  };
  retriedForQuality: boolean;
};
export type Observer = {
  stage: (s: string, progress: number) => void;
  progress: (p: number) => void;
};
export type Engine = {
  ff: FFmpeg;
  destroy: () => void;
  run: (args: string[], duration?: number) => Promise<void>;
  cancelled: () => boolean;
};
export async function createEngine(
  observer: Observer,
  isCancelled: () => boolean,
): Promise<Engine> {
  const ff = new FFmpeg();
  let expected = 0;
  let lastError = "";
  ff.on("log", ({ message }) => {
    if (/error|invalid|not found|unsupported|memory|failed/i.test(message))
      lastError = message.slice(0, 250);
  });
  ff.on("progress", ({ time }) => {
    if (expected && Number.isFinite(time))
      observer.progress(Math.max(0, Math.min(1, time / 1e6 / expected)));
  });
  const engine: Engine = {
    ff,
    cancelled: isCancelled,
    destroy: () => ff.terminate(),
    run: async (args, duration = 0) => {
      if (isCancelled()) throw Error("Обработка отменена");
      expected = duration;
      lastError = "";
      const code = await ff.exec(args, 600000);
      expected = 0;
      if (code !== 0)
        throw Error(
          lastError ||
            "Не удалось обработать файл. Проверьте кодек, уменьшите разрешение или включите экономичный режим.",
        );
    },
  };
  observer.stage("Загрузка движка FFmpeg…", 0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      ff.load({
        coreURL: "/ffmpeg/ffmpeg-core.js",
        wasmURL: "/ffmpeg/ffmpeg-core.wasm",
      }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Error(
                "Движок не загрузился за 90 секунд. Проверьте соединение и повторите.",
              ),
            ),
          90000,
        );
      }),
    ]);
    return engine;
  } catch (error) {
    ff.terminate();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
export async function writeRetained(
  ff: Pick<FFmpeg, "writeFile">,
  name: string,
  data: Uint8Array,
) {
  await ff.writeFile(name, new Uint8Array(data));
}
async function bytes(ff: FFmpeg, name: string) {
  const d = await ff.readFile(name);
  if (typeof d === "string") throw Error("Некорректные данные видео");
  return new Uint8Array(d);
}
export async function probeFile(
  e: Engine,
  name: string,
  count = false,
): Promise<Probe> {
  const path = "probe.json";
  await e.ff.deleteFile(path).catch(() => {});
  const code = await e.ff.ffprobe(
    [
      "-v",
      "error",
      ...(count ? ["-count_frames"] : []),
      "-show_format",
      "-show_streams",
      "-of",
      "json",
      name,
      "-o",
      path,
    ],
    120000,
  );
  try {
    const raw = await e.ff.readFile(path, "utf8");
    if (typeof raw !== "string") throw Error("Invalid probe data");
    const result = JSON.parse(raw);
    if (
      ![0, -1].includes(code) ||
      !Array.isArray(result.streams) ||
      !result.format ||
      !Number.isFinite(Number(result.format.duration))
    )
      throw Error("Invalid probe result");
    return result as Probe;
  } catch {
    throw Error(
      "Не удалось прочитать видео. Файл повреждён или кодек не поддерживается.",
    );
  } finally {
    await e.ff.deleteFile(path).catch(() => {});
  }
}

function canvasPng(c: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) =>
    c.toBlob(
      (b) =>
        b ? resolve(b) : reject(Error("Не удалось создать текстовый слой")),
      "image/png",
    ),
  );
}
async function textLayer(
  text: string,
  s: Settings,
  w: number,
  h: number,
  y: number,
) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw Error("Браузер не поддерживает Canvas");
  const size = Math.max(12, (s.overlaySize * w) / 1080);
  ctx.font = `600 ${size}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, size * 0.12);
  ctx.strokeStyle = "rgba(0,0,0,.9)";
  ctx.fillStyle = "white";
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? line + " " + word : word;
      if (ctx.measureText(next).width > w * 0.88 && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
  }
  const selected = lines.slice(0, 6);
  selected.forEach((line, i) => {
    const yy = (h * y) / 100 + (i - (selected.length - 1) / 2) * size * 1.25;
    ctx.strokeText(line, (w * s.overlayX) / 100, yy, w * 0.9);
    ctx.fillText(line, (w * s.overlayX) / 100, yy, w * 0.9);
  });
  return new Uint8Array(await (await canvasPng(c)).arrayBuffer());
}
async function overlayFiles(
  e: Engine,
  s: Settings,
  w: number,
  h: number,
  t: Timeline,
  paths: string[],
) {
  const specs: { text: string; start: number; end: number; y: number }[] = [];
  if (s.overlay.trim())
    specs.push({ text: s.overlay, start: 0, end: t.duration, y: s.overlayY });
  if (s.hook.trim())
    specs.push({
      text: s.hook,
      start: 0,
      end: Math.min(t.duration, s.hookSeconds),
      y: 18,
    });
  const cues = parseSrt(s.subtitles);
  if (s.subtitles.trim() && !cues.length)
    throw Error(
      "В субтитрах нет корректных SRT/VTT реплик. Проверьте временные отметки.",
    );
  if (cues.length > 80)
    throw Error(
      "Максимум 80 реплик субтитров на ролик. Разделите длинный текст.",
    );
  for (const cue of cues) {
    const start = cue.start / s.speed,
      end = Math.min(t.duration, cue.end / s.speed);
    if (start < end) specs.push({ ...cue, start, end, y: 88 });
  }
  const d = dimensions(s, w, h),
    result = [];
  for (let i = 0; i < specs.length; i++) {
    const o = specs[i],
      path = `layer${i}.png`;
    paths.push(path);
    await e.ff.writeFile(
      path,
      await textLayer(o.text, s, d.width, d.height, o.y),
    );
    result.push({ path, start: o.start, end: o.end });
  }
  return result;
}
async function hash(blob: Blob) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
async function playback(blob: Blob) {
  if (typeof document === "undefined") return false;
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  const url = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            Error(
              "Браузер не смог проверить воспроизведение за 30 секунд. Попробуйте MP4 или уменьшите разрешение.",
            ),
          ),
        30000,
      );
      v.onloadeddata = () => {
        clearTimeout(timer);
        resolve();
      };
      v.onerror = () => {
        clearTimeout(timer);
        reject(
          Error(
            "Готовое видео не воспроизводится в этом браузере. Используйте MP4 H.264/AAC.",
          ),
        );
      };
      v.src = url;
      v.load();
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Не удалось декодировать кадр в конце видео")),
        15000,
      );
      v.onseeked = () => {
        clearTimeout(timer);
        resolve();
      };
      v.onerror = () => {
        clearTimeout(timer);
        reject(Error("Ошибка воспроизведения результата"));
      };
      v.currentTime = Math.max(0.001, v.duration * 0.9);
    });
    return true;
  } finally {
    v.removeAttribute("src");
    v.load();
    URL.revokeObjectURL(url);
  }
}
async function compute(
  a: Uint8Array,
  b: Uint8Array,
  w: number,
  h: number,
  isCancelled: () => boolean,
): Promise<FrameMetrics> {
  const worker = new Worker(new URL("../workers/metrics.ts", import.meta.url));
  try {
    return await new Promise<FrameMetrics>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Превышено время расчёта метрик")),
        30000,
      );
      worker.onerror = () => {
        clearTimeout(timer);
        reject(Error("Не удалось запустить анализ кадров"));
      };
      worker.onmessage = (event) => {
        clearTimeout(timer);
        if (isCancelled()) reject(Error("Обработка отменена"));
        else if (event.data.error) reject(Error(event.data.error));
        else resolve(event.data.result);
      };
      worker.postMessage({ a, b, w, h }, [a.buffer, b.buffer]);
    });
  } finally {
    worker.terminate();
  }
}
async function analyze(
  e: Engine,
  input: string,
  output: string,
  s: Settings,
  p: Probe,
  t: Timeline,
  stage: Observer["stage"],
): Promise<Analysis> {
  const v = videoStream(p),
    display = displaySize(v),
    d = dimensions(s, display.width, display.height),
    w = 160,
    h = Math.max(32, Math.round(((d.height / d.width) * w) / 2) * 2);
  if (h > 640) throw Error("Слишком узкое видео для анализа");
  const count = Math.min(s.analysisSamples, t.baseFrames, t.frames),
    validFrames = Math.min(t.baseFrames, t.frames),
    indices = Array.from({ length: count }, (_, i) =>
      Math.min(
        validFrames - 1,
        Math.floor((validFrames * (i + 1)) / (count + 1)),
      ),
    );
  const select = "select=" + indices.map((n) => `eq(n\\,${n})`).join("+");
  stage("Извлечение синхронизированных кадров", 80);
  await e.run([
    "-i",
    input,
    "-vf",
    [
      `setpts=(PTS-STARTPTS)/${s.speed.toFixed(7)}`,
      ...geometry(s, display.width, display.height),
      `fps=${s.fps}`,
      select,
      `scale=${w}:${h}:flags=area`,
    ].join(","),
    "-vsync",
    "0",
    "-frames:v",
    String(count),
    "-pix_fmt",
    "rgb24",
    "-f",
    "rawvideo",
    "-y",
    "a.rgb",
  ]);
  await e.run([
    "-i",
    output,
    "-vf",
    [select, `scale=${w}:${h}:flags=area`].join(","),
    "-vsync",
    "0",
    "-frames:v",
    String(count),
    "-pix_fmt",
    "rgb24",
    "-f",
    "rawvideo",
    "-y",
    "b.rgb",
  ]);
  const a = await bytes(e.ff, "a.rgb"),
    b = await bytes(e.ff, "b.rgb"),
    length = w * h * 3;
  if (a.length !== length * count || b.length !== length * count)
    throw Error("Не удалось выровнять кадры для сравнения");
  const samples: Sample[] = [];
  let heatmap = "";
  for (let i = 0; i < count; i++) {
    stage(`Расчёт метрик ${i + 1}/${count}`, 83 + (9 * i) / count);
    const result = await compute(
      a.slice(i * length, (i + 1) * length),
      b.slice(i * length, (i + 1) * length),
      w,
      h,
      e.cancelled,
    );
    const { heat, ...values } = result;
    const time = indices[i] / s.fps;
    samples.push({ time, sourceTime: time * s.speed, ...values });
    if (i === Math.floor(count / 2)) {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d")!.putImageData(
        new ImageData(new Uint8ClampedArray(heat), w, h),
        0,
        0,
      );
      heatmap = c.toDataURL("image/png");
    }
  }
  const avg = (key: "mae" | "ssim" | "hashDistance") =>
    samples.reduce((sum, x) => sum + x[key], 0) / samples.length;
  const mae = avg("mae");
  return {
    mae,
    ssim: avg("ssim"),
    hashDistance: avg("hashDistance"),
    samples,
    width: w,
    height: h,
    heatmap,
    targetMae: [7, 8],
    withinTarget: mae >= 7 && mae <= 8,
  };
}

const allTags = (p: Probe) =>
  Object.fromEntries([
    ...Object.entries(p.format.tags || {}).map(([k, v]) => ["format:" + k, v]),
    ...p.streams.flatMap((s, i) =>
      Object.entries(s.tags || {}).map(([k, v]) => ["stream" + i + ":" + k, v]),
    ),
  ]);
export async function processVideo(
  e: Engine,
  file: File,
  s: Settings,
  index: number,
  observer: Observer,
) {
  const paths = [
    "input",
    "encoded." + s.format,
    "final." + s.format,
    "probe.json",
    "a.rgb",
    "b.rgb",
  ];
  const outputName =
    file.name
      .replace(/\.[^.]+$/, "")
      .replace(/[^\p{L}\p{N}._-]/gu, "_")
      .slice(0, 80) + `_v${String(index + 1).padStart(3, "0")}.${s.format}`;
  try {
    observer.stage("Анализ исходного видео", 1);
    await e.ff.writeFile("input", new Uint8Array(await file.arrayBuffer()));
    const source = await probeFile(e, "input", true),
      v = videoStream(source);
    const duration = Number(v.duration || source.format.duration),
      display = displaySize(v);
    if (["smpte2084", "arib-std-b67"].includes(v.color_transfer || ""))
      throw Error(
        "Исходник использует HDR. Сначала экспортируйте SDR H.264, чтобы сохранить правильные цвета.",
      );
    if (!v.width || !v.height || v.width * v.height > 3840 * 2160)
      throw Error("Поддерживается видео до 4K. Уменьшите исходное разрешение.");
    const t = timeline(s, duration, index);
    const hasAudio = source.streams.some((x) => x.codec_type === "audio");
    let settings = s,
      analysis: Analysis | null = null,
      cleaned!: Uint8Array,
      removed: string[] = [],
      retried = false,
      output!: Probe;
    for (let attempt = 0; attempt < 2; attempt++) {
      observer.stage(
        attempt
          ? "Снижение интенсивности: повторное кодирование исходника"
          : "Кодирование видео",
        5,
      );
      const overlays = await overlayFiles(
        e,
        settings,
        display.width,
        display.height,
        t,
        paths,
      );
      await e.run(
        buildArgs(
          "input",
          "encoded." + s.format,
          settings,
          display.width,
          display.height,
          hasAudio,
          t,
          source,
          overlays,
        ),
        t.duration,
      );
      observer.stage("Финальная очистка метаданных", 76);
      cleaned = await bytes(e.ff, "encoded." + s.format);
      removed =
        settings.metadata === "strip" && settings.format === "mp4"
          ? cleanMp4(cleaned)
          : [];
      await writeRetained(e.ff, "final." + s.format, cleaned);
      observer.stage("Проверка потоков и количества кадров", 78);
      output = await probeFile(e, "final." + s.format, true);
      const out = videoStream(output),
        frames = Number(out.nb_read_frames || out.nb_frames);
      if (frames !== t.frames)
        throw Error(
          `Контроль кадров: получено ${frames}, ожидалось ${t.frames}`,
        );
      if (
        Math.abs(Number(out.duration || output.format.duration) - t.duration) >
        Math.max(0.12, 2 / s.fps)
      )
        throw Error("Длительность результата не соответствует временной шкале");
      const d = dimensions(s, display.width, display.height);
      if (
        out.width !== d.width ||
        out.height !== d.height ||
        Math.abs(ratio(out.avg_frame_rate) - s.fps) > 0.01
      )
        throw Error("Не совпадают разрешение или частота кадров");
      const audio = output.streams.find((x) => x.codec_type === "audio");
      if (hasAudio && !s.mute && !audio)
        throw Error("Аудиодорожка потеряна при кодировании");
      if (
        audio &&
        Math.abs(
          Number(audio.duration || output.format.duration) - t.duration,
        ) > 0.15
      )
        throw Error("Длительность звука не совпадает с видео");
      if (
        s.format === "mp4" &&
        (out.codec_name !== "h264" ||
          out.pix_fmt !== "yuv420p" ||
          (audio &&
            (audio.codec_name !== "aac" ||
              audio.profile !== "LC" ||
              !["44100", "48000"].includes(audio.sample_rate || ""))) ||
          !fastStart(cleaned))
      )
        throw Error("Результат не прошёл проверку профиля MP4 для iPhone");
      analysis = s.analysis
        ? await analyze(
            e,
            "input",
            "final." + s.format,
            settings,
            source,
            t,
            observer.stage,
          )
        : null;
      if (
        attempt === 0 &&
        analysis &&
        analysis.ssim < 0.75 &&
        s.qualityRetry &&
        !s.overlay.trim() &&
        !s.hook.trim() &&
        !s.subtitles.trim()
      ) {
        settings = soften(s);
        retried = true;
        continue;
      }
      break;
    }
    observer.stage("Полное декодирование видео и звука", 94);
    await e.run([
      "-v",
      "error",
      "-xerror",
      "-i",
      "final." + s.format,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-f",
      "null",
      "-",
    ]);
    const blob = new Blob([new Uint8Array(cleaned)], {
      type: s.format === "mp4" ? "video/mp4" : "video/webm",
    });
    observer.stage("Проверка воспроизведения в браузере", 97);
    const browserPlayback = await playback(blob);
    const remaining = allTags(output),
      metadataWarnings: string[] = [];
    if (s.metadata === "strip") {
      const unexpected = Object.keys(remaining).filter(
        (k) =>
          ![
            "major_brand",
            "minor_version",
            "compatible_brands",
            "language",
            "handler_name",
            "vendor_id",
          ].includes(k.split(":").pop()!),
      );
      if (unexpected.length)
        metadataWarnings.push(
          "Остались необязательные поля: " + unexpected.join(", "),
        );
    }
    const warnings = [...metadataWarnings];
    if (analysis && analysis.ssim < 0.85)
      warnings.push(
        "SSIM ниже 0.85: проверьте карту различий и предпросмотр. Текст и зерно тоже влияют на SSIM.",
      );
    if (s.format === "webm")
      warnings.push(
        "WebM выбран вручную; воспроизведение на iPhone зависит от версии iOS.",
      );
    if (!hasAudio)
      warnings.push(
        "В исходном видео нет звука. Результат сохранён без аудио.",
      );
    const out = videoStream(output);
    const report: Report = {
      version: "2.0",
      sourceName: file.name,
      outputName,
      settings,
      timeline: t,
      source,
      output,
      analysis,
      sourceSha256: await hash(file),
      outputSha256: await hash(blob),
      metadata: { removed, remaining, warnings: metadataWarnings },
      warnings,
      checks: {
        decoded: true,
        browserPlayback,
        frames: Number(out.nb_read_frames || out.nb_frames),
        expectedFrames: t.frames,
        audio: output.streams.some((x) => x.codec_type === "audio"),
        fastStart: s.format === "mp4" ? fastStart(cleaned) : null,
      },
      retriedForQuality: retried,
    };
    observer.stage("Проверено", 100);
    return { blob, name: outputName, report };
  } finally {
    for (const path of new Set(paths))
      await e.ff.deleteFile(path).catch(() => {});
  }
}
