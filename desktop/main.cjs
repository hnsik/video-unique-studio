"use strict";
const {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  session,
  dialog,
  shell,
  Menu,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const {
  ensureTools,
  validatePair,
  saveConfig,
} = require("./lib/dependencies.cjs");
const { NativeEngine } = require("./lib/native-engine.cjs");
const run = promisify(execFile),
  selfTest = process.argv.includes("--self-test");
const reportIndex = process.argv.indexOf("--self-test");
const reportPath = selfTest ? process.argv[reportIndex + 1] : null;
if (selfTest && !reportPath) throw Error("Missing self-test report path");
if (selfTest)
  app.setPath("userData", path.join(os.tmpdir(), "vus-self-test-profile"));
protocol.registerSchemesAsPrivileged([
  {
    scheme: "vus",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);
let window,
  engine,
  tools,
  status = { phase: "checking", message: "Проверяем компоненты…" },
  setupPromise,
  controller,
  quitting = false;
const toolsRoot = path.join(
  process.env.LOCALAPPDATA || app.getPath("userData"),
  "VideoUniqueStudio",
);
const jobsRoot = path.join(app.getPath("temp"), "VideoUniqueStudio-jobs");
const resultsRoot = path.join(app.getPath("downloads"), "Video Unique Studio");
let selfTestTimer;
function broadcast(value) {
  status = value;
  if (window && !window.isDestroyed())
    window.webContents.send("tools:update", value);
}
function assertSender(event) {
  if (
    !window ||
    event.sender.id !== window.webContents.id ||
    event.senderFrame !== event.sender.mainFrame
  )
    throw Error("Недопустимый отправитель");
  const url = new URL(event.senderFrame.url);
  const isApp = url.protocol === "vus:" && url.hostname === "studio";
  const isSplash =
    url.protocol === "file:" &&
    event.senderFrame.url ===
      pathToFileURL(path.join(__dirname, "splash.html")).href;
  if (!isApp && !isSplash) throw Error("Недопустимая страница");
}
function handle(name, callback) {
  ipcMain.handle(name, (event, ...args) => {
    assertSender(event);
    return callback(event, ...args);
  });
}
function getEngine() {
  if (!engine) throw Error("FFmpeg ещё не готов");
  return engine;
}
function attachTools(pair) {
  tools = pair;
  engine = new NativeEngine({
    tools,
    root: jobsRoot,
    onProgress: (event) => {
      if (window && !window.isDestroyed())
        window.webContents.send("native:progress", {
          id: event.id,
          time: event.time,
        });
    },
  });
  broadcast({
    phase: "ready",
    message: "Готово",
    tools: {
      version: tools.version,
      source: tools.source,
      ffmpeg: tools.ffmpeg,
    },
  });
}
async function prepare(forceDownload = false) {
  if (setupPromise) return setupPromise;
  controller = new AbortController();
  setupPromise = (async () => {
    try {
      const pair = await ensureTools({
        root: toolsRoot,
        onProgress: broadcast,
        signal: controller.signal,
        forceDownload,
      });
      attachTools(pair);
      await window.loadURL("vus://studio/");
    } catch (error) {
      broadcast({
        phase: "error",
        message: "Не удалось подготовить FFmpeg",
        error: error.message,
      });
      if (selfTest)
        await finishTest({ ok: false, error: error.stack || error.message });
    } finally {
      setupPromise = null;
    }
  })();
  return setupPromise;
}
async function finishTest(result) {
  if (!selfTest) throw Error("Self-test disabled");
  clearTimeout(selfTestTimer);
  await fs.mkdir(path.dirname(path.resolve(reportPath)), { recursive: true });
  await fs.writeFile(
    reportPath,
    JSON.stringify(
      {
        ...result,
        tools: tools && { source: tools.source, version: tools.version },
        electron: process.versions.electron,
        platform: process.platform,
      },
      null,
      2,
    ),
  );
  await engine?.closeAll();
  app.exit(result.ok ? 0 : 1);
}
function safeAsset(url) {
  const u = new URL(url);
  if (u.protocol !== "vus:" || u.hostname !== "studio")
    throw Error("Unknown app URL");
  let pathname = decodeURIComponent(u.pathname);
  if (pathname.includes("\0") || pathname.includes("\\"))
    throw Error("Invalid asset");
  if (pathname.endsWith("/")) pathname += "index.html";
  const root = path.join(__dirname, "renderer"),
    file = path.resolve(root, "." + pathname),
    relative = path.relative(root, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw Error("Invalid asset path");
  return file;
}
async function start() {
  protocol.handle("vus", async (request) => {
    try {
      const response = await net.fetch(
        pathToFileURL(safeAsset(request.url)).href,
      );
      const headers = new Headers(response.headers);
      headers.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      );
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  session.defaultSession.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  await fs.mkdir(resultsRoot, { recursive: true });
  session.defaultSession.on("will-download", (_event, item) => {
    const original =
      path
        .basename(item.getFilename())
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
        .slice(0, 180) || "video.mp4";
    const ext = path.extname(original),
      base = path.basename(original, ext);
    let target = path.join(resultsRoot, original),
      n = 2;
    const exists = require("node:fs").existsSync;
    while (exists(target))
      target = path.join(resultsRoot, `${base} (${n++})${ext}`);
    item.setSavePath(target);
  });
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 900,
    minHeight: 640,
    show: !selfTest,
    backgroundColor: "#0b1020",
    title: "Video Unique Studio",
    icon: path.join(__dirname, "assets/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    const u = new URL(url);
    if (!(u.protocol === "vus:" && u.hostname === "studio"))
      event.preventDefault();
  });
  window.webContents.on("did-fail-load", (_event, code, description) => {
    if (selfTest)
      void finishTest({
        ok: false,
        error: `Renderer load ${code}: ${description}`,
      });
  });
  handle("tools:status", () => ({ ...status, selfTest }));
  handle("tools:retry", () => prepare());
  handle("tools:choose", async () => {
    if (setupPromise) return;
    const choice = await dialog.showOpenDialog(window, {
      title: "Выберите ffmpeg.exe рядом с ffprobe.exe",
      properties: ["openFile"],
      filters: [{ name: "FFmpeg", extensions: ["exe"] }],
    });
    if (choice.canceled) return;
    try {
      const pair = {
        ...(await validatePair(
          choice.filePaths[0],
          path.join(path.dirname(choice.filePaths[0]), "ffprobe.exe"),
        )),
        source: "selected",
      };
      await saveConfig(toolsRoot, pair);
      attachTools(pair);
      await window.loadURL("vus://studio/");
    } catch (error) {
      broadcast({
        phase: "error",
        message: "Компоненты не подходят",
        error: error.message,
      });
    }
  });
  handle("native:create", (event) => getEngine().create(event.sender.id));
  handle("native:write", (event, id, name, data, offset) =>
    getEngine().write(id, event.sender.id, name, data, offset),
  );
  handle("native:stat", (event, id, name) =>
    getEngine().stat(id, event.sender.id, name),
  );
  handle("native:read", (event, id, name, offset, length, encoding) =>
    getEngine().read(id, event.sender.id, name, offset, length, encoding),
  );
  handle("native:remove", (event, id, name) =>
    getEngine().remove(id, event.sender.id, name),
  );
  handle("native:run", (event, id, kind, args, timeout) =>
    getEngine().run(id, event.sender.id, kind, args, timeout),
  );
  handle("native:close", (event, id) => getEngine().close(id, event.sender.id));
  handle("results:open", () => shell.openPath(resultsRoot));
  handle("selftest:fixture", async () => {
    if (!selfTest) throw Error("Self-test disabled");
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vus-fixture-"));
    try {
      const file = path.join(dir, "input.mp4");
      await run(
        tools.ffmpeg,
        [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=s=96x64:r=30:d=2",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=600:sample_rate=44100:duration=0.6",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-y",
          file,
        ],
        { windowsHide: true, timeout: 30000 },
      );
      return new Uint8Array(await fs.readFile(file));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
  handle("selftest:finish", (_event, result) => finishTest(result));
  if (selfTest) {
    selfTestTimer = setTimeout(
      () =>
        void finishTest({
          ok: false,
          error: "Desktop integration test timed out",
        }),
      240000,
    );
  }
  await window.loadFile(path.join(__dirname, "splash.html"));
  void prepare(selfTest && process.argv.includes("--force-tool-download"));
}
if (!selfTest && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(start)
    .catch((error) => {
      if (selfTest) void finishTest({ ok: false, error: error.stack });
      else dialog.showErrorBox("Video Unique Studio", error.message);
    });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (quitting) return;
    quitting = true;
    controller?.abort();
    if (engine) {
      event.preventDefault();
      engine.closeAll().finally(() => app.quit());
    }
  });
}
