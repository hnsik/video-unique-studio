"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const valueOptions = new Set([
  "-i",
  "-vf",
  "-filter_complex",
  "-map",
  "-c:v",
  "-preset",
  "-crf",
  "-pix_fmt",
  "-profile:v",
  "-tag:v",
  "-deadline",
  "-cpu-used",
  "-b:v",
  "-af",
  "-c:a",
  "-ar",
  "-b:a",
  "-profile:a",
  "-t",
  "-map_metadata",
  "-map_chapters",
  "-metadata",
  "-metadata:s:v",
  "-movflags",
  "-vsync",
  "-fps_mode",
  "-frames:v",
  "-f",
  "-v",
  "-of",
  "-o",
]);
const flags = new Set([
  "-y",
  "-xerror",
  "-count_frames",
  "-show_format",
  "-show_streams",
]);
const filters = new Set([
  "split",
  "asplit",
  "concat",
  "zoompan",
  "adelay",
  "amix",
  "alimiter",
  "setpts",
  "crop",
  "hflip",
  "scale",
  "setsar",
  "eq",
  "hue",
  "noise",
  "vignette",
  "fps",
  "tpad",
  "trim",
  "overlay",
  "atempo",
  "volume",
  "loudnorm",
  "afade",
  "apad",
  "atrim",
  "asetpts",
  "select",
]);
function safeName(name) {
  if (
    typeof name !== "string" ||
    !/^[a-z][a-z0-9_.-]{0,95}$/.test(name) ||
    name.includes("..") ||
    /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)
  )
    throw Error("Недопустимое имя временного файла");
  return name;
}
function validateFilters(text) {
  let quote = "",
    depth = 0,
    escaped = false,
    part = "";
  const parts = [];
  for (const ch of text) {
    if (escaped) {
      part += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      part += ch;
      escaped = true;
      continue;
    }
    if (quote) {
      part += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      part += ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if ((ch === "," || ch === ";") && depth === 0) {
      parts.push(part);
      part = "";
    } else part += ch;
  }
  parts.push(part);
  if (quote || depth !== 0) throw Error("Некорректный фильтр");
  for (const value of parts) {
    const body = value.replace(/^(?:\s*\[[^\]]+\])+\s*/, "").trim();
    const name = body.match(/^([a-z][a-z0-9_]*)(?:=|\s*\[|$)/i)?.[1];
    if (!filters.has(name))
      throw Error("Недопустимый видео/аудиофильтр: " + (name || "?"));
  }
}
function validateArgs(kind, args) {
  if (
    !["ffmpeg", "ffprobe"].includes(kind) ||
    !Array.isArray(args) ||
    args.length > 500 ||
    !args.length
  )
    throw Error("Некорректная команда");
  let positionals = 0;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (typeof arg !== "string" || arg.includes("\0") || arg.length > 100000)
      throw Error("Некорректный аргумент");
    if (valueOptions.has(arg)) {
      const value = args[++i];
      if (
        typeof value !== "string" ||
        value.includes("\0") ||
        value.length > 100000
      )
        throw Error("Отсутствует значение параметра");
      if (["-i", "-o"].includes(arg)) safeName(value);
      if (["-vf", "-af", "-filter_complex"].includes(arg))
        validateFilters(value);
      if (arg === "-f" && !["null", "rawvideo"].includes(value))
        throw Error("Недопустимый формат промежуточного файла");
    } else if (flags.has(arg)) continue;
    else {
      if (arg !== "-") safeName(arg);
      positionals++;
    }
  }
  if (positionals !== 1)
    throw Error("Нужен один выходной или исследуемый файл");
}
class NativeEngine {
  constructor({ tools, root, onProgress = () => {} }) {
    this.tools = tools;
    this.root = root;
    this.onProgress = onProgress;
    this.jobs = new Map();
  }
  async create(owner) {
    await fs.mkdir(this.root, { recursive: true });
    const id = randomUUID(),
      dir = path.join(this.root, id);
    await fs.mkdir(dir);
    this.jobs.set(id, { owner, dir, child: null, closed: false });
    return id;
  }
  job(id, owner) {
    const job = this.jobs.get(id);
    if (!job || job.owner !== owner || job.closed)
      throw Error("Сессия обработки недоступна");
    return job;
  }
  async write(id, owner, name, data, offset) {
    const job = this.job(id, owner);
    safeName(name);
    if (job.child) throw Error("Сначала завершите команду");
    if (
      !(data instanceof Uint8Array) ||
      data.byteLength > 4 * 1024 * 1024 ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > 4 * 1024 * 1024 * 1024
    )
      throw Error("Некорректный блок файла");
    const target = path.join(job.dir, name);
    if (offset === 0) await fs.writeFile(target, data);
    else {
      const h = await fs.open(target, "r+");
      try {
        if ((await h.stat()).size !== offset)
          throw Error("Нарушен порядок блоков");
        await h.write(data, 0, data.length, offset);
      } finally {
        await h.close();
      }
    }
  }
  async stat(id, owner, name) {
    const job = this.job(id, owner);
    safeName(name);
    return (await fs.stat(path.join(job.dir, name))).size;
  }
  async read(id, owner, name, offset, length, encoding) {
    const job = this.job(id, owner);
    safeName(name);
    const target = path.join(job.dir, name);
    if (encoding === "utf8") {
      if ((await fs.stat(target)).size > 5 * 1024 * 1024)
        throw Error("Отчёт слишком большой");
      return fs.readFile(target, "utf8");
    }
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(length) ||
      length < 0 ||
      length > 4 * 1024 * 1024
    )
      throw Error("Некорректный запрос блока");
    const h = await fs.open(target, "r");
    try {
      const out = Buffer.alloc(length);
      const { bytesRead } = await h.read(out, 0, length, offset);
      return new Uint8Array(out.subarray(0, bytesRead));
    } finally {
      await h.close();
    }
  }
  async remove(id, owner, name) {
    const job = this.job(id, owner);
    safeName(name);
    await fs.rm(path.join(job.dir, name), { force: true });
  }
  async run(id, owner, kind, args, timeout = 600000) {
    const job = this.job(id, owner);
    if (job.child) throw Error("Команда уже выполняется");
    validateArgs(kind, args);
    // The browser core uses legacy -vsync 0; native FFmpeg 9 removed it.
    // fps_mode passthrough has the same frame-preserving behavior (FFmpeg 5+).
    args = args.flatMap((arg, index) => {
      if (arg === "-vsync") {
        if (args[index + 1] !== "0") throw Error("Недопустимый режим кадров");
        return ["-fps_mode", "passthrough"];
      }
      return args[index - 1] === "-vsync" ? [] : [arg];
    });
    if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 1800000)
      throw Error("Некорректное ограничение времени");
    let stderr = "",
      partial = "";
    const extra =
      kind === "ffmpeg"
        ? [
            "-nostdin",
            "-hide_banner",
            "-progress",
            "pipe:1",
            "-nostats",
            "-protocol_whitelist",
            "file,pipe",
          ]
        : ["-protocol_whitelist", "file,pipe"];
    return new Promise((resolve, reject) => {
      const child = spawn(this.tools[kind], [...extra, ...args], {
        cwd: job.dir,
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      job.child = child;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeout);
      job.finished = new Promise((r) => child.once("close", r));
      child.stdout.on("data", (chunk) => {
        partial += chunk.toString();
        const lines = partial.split(/\r?\n/);
        partial = lines.pop().slice(-1000);
        for (const line of lines) {
          const m = line.match(/^out_time_(?:us|ms)=(\d+)/);
          if (m) this.onProgress({ id, owner, time: Number(m[1]) });
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-6000);
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        job.child = null;
        reject(Error("Не удалось запустить " + kind + ": " + error.message));
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        job.child = null;
        if (job.closed) reject(Error("Обработка отменена"));
        else if (timedOut)
          reject(Error("Превышено время обработки. Уменьшите разрешение."));
        else if (code !== 0)
          reject(
            Error(
              stderr.trim().split(/\r?\n/).slice(-4).join("\n") ||
                kind + " завершился с ошибкой " + code,
            ),
          );
        else resolve(0);
      });
    });
  }
  async close(id, owner) {
    const job = this.jobs.get(id);
    if (!job || job.owner !== owner) return;
    job.closed = true;
    if (job.child) {
      job.child.kill();
      await job.finished;
    }
    this.jobs.delete(id);
    await fs.rm(job.dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 150,
    });
  }
  async closeAll() {
    for (const [id, job] of this.jobs) await this.close(id, job.owner);
  }
}
module.exports = { NativeEngine, safeName, validateArgs, validateFilters };
