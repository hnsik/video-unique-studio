"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createHash, randomUUID } = require("node:crypto");
const { createWriteStream } = require("node:fs");
const { pipeline } = require("node:stream/promises");
const { Readable, Transform } = require("node:stream");
const AdmZip = require("adm-zip");
const run = promisify(execFile);
const manifest = require("../ffmpeg-manifest.json");

async function validatePair(ffmpeg, ffprobe) {
  if (!path.isAbsolute(ffmpeg) || !path.isAbsolute(ffprobe))
    throw Error("Нужны абсолютные пути к FFmpeg и FFprobe");
  const options = {
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 3 * 1024 * 1024,
  };
  const [fm, fp, encoders, filters] = await Promise.all([
    run(ffmpeg, ["-version"], options),
    run(ffprobe, ["-version"], options),
    run(ffmpeg, ["-hide_banner", "-encoders"], options),
    run(ffmpeg, ["-hide_banner", "-filters"], options),
  ]);
  const mv = fm.stdout.match(/^ffmpeg version (?:n)?(\d+)(?:\.(\d+))?/),
    pv = fp.stdout.match(/^ffprobe version (?:n)?(\d+)(?:\.(\d+))?/);
  if (!mv || !pv || Number(mv[1]) < 5 || mv[1] !== pv[1])
    throw Error("Нужны совместимые FFmpeg и FFprobe версии 5 или новее");
  for (const name of ["libx264", "aac", "png", "libvpx-vp9", "libopus"])
    if (!new RegExp("\\b" + name + "\\b").test(encoders.stdout))
      throw Error("В FFmpeg нет кодировщика " + name);
  for (const name of [
    "eq",
    "overlay",
    "loudnorm",
    "atempo",
    "apad",
    "atrim",
    "tpad",
    "noise",
    "select",
  ])
    if (!new RegExp("\\b" + name + "\\b").test(filters.stdout))
      throw Error("В FFmpeg нет фильтра " + name);
  return {
    ffmpeg,
    ffprobe,
    version: fm.stdout.split(/\r?\n/)[0].slice(0, 160),
  };
}
async function readConfig(root) {
  try {
    return JSON.parse(await fs.readFile(path.join(root, "tools.json"), "utf8"));
  } catch {
    return null;
  }
}
async function saveConfig(root, pair) {
  await fs.mkdir(root, { recursive: true });
  const temp = path.join(root, "tools-" + randomUUID() + ".json");
  await fs.writeFile(temp, JSON.stringify(pair));
  await fs.rename(temp, path.join(root, "tools.json"));
}
async function managedPairs(root, ext = ".exe") {
  const base = path.join(root, "tools");
  const names = [manifest.version];
  try {
    for (const entry of await fs.readdir(base, { withFileTypes: true }))
      if (entry.isDirectory() && entry.name.startsWith(manifest.version + "-"))
        names.push(entry.name);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return names.map((name) => ({
    ffmpeg: path.join(base, name, "ffmpeg" + ext),
    ffprobe: path.join(base, name, "ffprobe" + ext),
    source: "cache",
  }));
}
async function candidates(
  root,
  platform = process.platform,
  env = process.env,
) {
  const ext = platform === "win32" ? ".exe" : "";
  const result = [];
  const config = await readConfig(root);
  if (config?.ffmpeg && config?.ffprobe)
    result.push({
      ffmpeg: config.ffmpeg,
      ffprobe: config.ffprobe,
      source: "saved",
    });
  result.push(...await managedPairs(root, ext));
  const dirs = (env.PATH || env.Path || "")
    .split(platform === "win32" ? ";" : ":")
    .filter(Boolean);
  if (platform === "win32")
    dirs.push(
      ...[
        env.LOCALAPPDATA &&
          path.join(env.LOCALAPPDATA, "Microsoft", "WinGet", "Links"),
        env.LOCALAPPDATA &&
          path.join(env.LOCALAPPDATA, "VideoDownloaderStudio", "bin"),
        env.LOCALAPPDATA &&
          path.join(
            env.LOCALAPPDATA,
            "VideoDownloaderStudio",
            ".venv",
            "Scripts",
          ),
        env.LOCALAPPDATA &&
          path.join(env.LOCALAPPDATA, "VideoDownloaderStudio", "tools"),
        env.LOCALAPPDATA &&
          path.join(env.LOCALAPPDATA, "VideoDownloaderStudio"),
        env.LOCALAPPDATA &&
          path.join(env.LOCALAPPDATA, "VideoDownloaderStudio", "ffmpeg", "bin"),
        env.ProgramFiles && path.join(env.ProgramFiles, "ffmpeg", "bin"),
        env.ProgramData && path.join(env.ProgramData, "chocolatey", "bin"),
        env.USERPROFILE &&
          path.join(
            env.USERPROFILE,
            "scoop",
            "apps",
            "ffmpeg",
            "current",
            "bin",
          ),
        "C:\\ffmpeg\\bin",
      ].filter(Boolean),
    );
  for (const dir of [...new Set(dirs)])
    if (path.isAbsolute(dir))
      result.push({
        ffmpeg: path.join(dir, "ffmpeg" + ext),
        ffprobe: path.join(dir, "ffprobe" + ext),
        source: "existing",
      });
  return result;
}
async function downloadArchive(
  url,
  destination,
  expectedHash,
  onProgress,
  signal,
) {
  let current = new URL(url),
    response;
  for (let redirects = 0; redirects < 5; redirects++) {
    if (current.protocol !== "https:" || current.hostname !== "www.gyan.dev")
      throw Error("Недопустимый адрес загрузки FFmpeg");
    response = await fetch(current, { redirect: "manual", signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      current = new URL(response.headers.get("location"), current);
      continue;
    }
    break;
  }
  if (!response?.ok || !response.body)
    throw Error(
      "Не удалось скачать FFmpeg. Проверьте интернет и нажмите «Повторить».",
    );
  const total = Number(response.headers.get("content-length") || 0),
    max = 300 * 1024 * 1024;
  if (total > max) throw Error("Архив FFmpeg слишком большой");
  const hash = createHash("sha256");
  let received = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > max) {
        callback(Error("Превышен размер загрузки"));
        return;
      }
      hash.update(chunk);
      onProgress({
        phase: "download",
        message: "Скачиваем FFmpeg и FFprobe…",
        received,
        total,
        percent: total ? Math.min(99, (received / total) * 100) : null,
      });
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body),
    meter,
    createWriteStream(destination, { flags: "wx" }),
    { signal },
  );
  if (hash.digest("hex") !== expectedHash)
    throw Error(
      "Контрольная сумма FFmpeg не совпала. Загрузка отклонена; повторите попытку.",
    );
}
async function installArchive(archive, root, { validate = validatePair } = {}) {
  const base = path.join(root, "tools");
  await fs.mkdir(base, { recursive: true });
  // A just-executed EXE can remain locked by Windows/security software.
  // Extract directly into a unique final directory: never move executed files.
  for (const pair of await managedPairs(root)) {
    try {
      return await validate(pair.ffmpeg, pair.ffprobe);
    } catch {}
  }
  const stage = path.join(base, manifest.version + "-" + randomUUID());
  await fs.mkdir(stage);
  let installed = false;
  try {
    const zip = new AdmZip(archive),
      found = new Set();
    for (const entry of zip.getEntries()) {
      const name = entry.entryName.replace(/\\/g, "/").split("/").pop();
      if (
        !["ffmpeg.exe", "ffprobe.exe", "LICENSE"].includes(name) ||
        entry.isDirectory
      )
        continue;
      if (found.has(name))
        throw Error("Повторяющийся компонент в архиве FFmpeg");
      if (entry.header.size > 200 * 1024 * 1024)
        throw Error("Компонент FFmpeg слишком большой");
      found.add(name);
      await fs.writeFile(path.join(stage, name), entry.getData(), {
        flag: "wx",
      });
    }
    if (!found.has("ffmpeg.exe") || !found.has("ffprobe.exe"))
      throw Error("В архиве нет FFmpeg/FFprobe");
    await fs.writeFile(
      path.join(stage, "SOURCE-AND-LICENSE.txt"),
      `FFmpeg ${manifest.version}\nBuild: ${manifest.provider}\nSource: ${manifest.source}\nLicense: ${manifest.license}\nArchive SHA256: ${manifest.sha256}\n`,
    );
    const result = await validate(
      path.join(stage, "ffmpeg.exe"),
      path.join(stage, "ffprobe.exe"),
    );
    installed = true;
    return result;
  } finally {
    if (!installed)
      await fs.rm(stage, {
        recursive: true, force: true, maxRetries: 10, retryDelay: 200,
      }).catch(() => {});
  }
}
async function ensureTools({
  root,
  onProgress = () => {},
  signal,
  forceDownload = false,
  platform = process.platform,
  validate = validatePair,
  env = process.env,
}) {
  await fs.mkdir(root, { recursive: true });
  onProgress({
    phase: "checking",
    message: "Проверяем установленные FFmpeg и FFprobe…",
  });
  if (!forceDownload)
    for (const pair of await candidates(root, platform, env)) {
      signal?.throwIfAborted();
      try {
        await fs.access(pair.ffmpeg);
        await fs.access(pair.ffprobe);
        const result = {
          ...(await validate(pair.ffmpeg, pair.ffprobe)),
          source: pair.source,
        };
        await saveConfig(root, result);
        onProgress({
          phase: "ready",
          message: "FFmpeg и FFprobe готовы",
          tools: result,
        });
        return result;
      } catch (error) {
        if (signal?.aborted) throw error;
      }
    }
  if (platform !== "win32")
    throw Error(
      "Для разработки установите FFmpeg/FFprobe в PATH. Автозагрузка предназначена для Windows x64.",
    );
  const archive = path.join(root, "ffmpeg-" + randomUUID() + ".zip");
  try {
    await downloadArchive(
      manifest.url,
      archive,
      manifest.sha256,
      onProgress,
      signal,
    );
    signal?.throwIfAborted();
    onProgress({
      phase: "extracting",
      message: "Проверяем и устанавливаем компоненты…",
    });
    const result = {
      ...(await installArchive(archive, root, { validate })),
      source: "downloaded",
    };
    await saveConfig(root, result);
    onProgress({
      phase: "ready",
      message: "FFmpeg и FFprobe готовы",
      tools: result,
    });
    return result;
  } catch (error) {
    if (error.name === "AbortError") throw Error("Подготовка отменена");
    throw error;
  } finally {
    await fs.rm(archive, { force: true });
  }
}
module.exports = {
  validatePair,
  candidates,
  ensureTools,
  installArchive,
  downloadArchive,
  saveConfig,
};
