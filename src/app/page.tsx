"use client";
import { useEffect, useRef, useState } from "react";
import {
  Film,
  UploadCloud,
  Play,
  Square,
  Download,
  Trash2,
  SlidersHorizontal,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  FileArchive,
  Save,
  FolderOpen,
  Activity,
  Share2,
} from "lucide-react";
import {
  defaults,
  validateSettings,
  generateSrt,
  parseSrt,
  type Settings,
} from "@/lib/processing";
import { createEngine, processVideo, type Engine } from "@/lib/pipeline";
import {
  visualPresets,
  applyVisualPreset,
  hasVisualEffects,
  type VisualPreset,
} from "@/lib/visual-presets";
import {
  saveTask,
  listTasks,
  deleteTask,
  saveSource,
  getSource,
  deleteSource,
  deleteReference,
  ensureSpace,
  listSources,
  type Task,
} from "@/lib/storage";
import { createPlan } from "@/lib/queue";
import RuntimeStatus from "./RuntimeStatus";
import { csv, reports, saveDownload, createZip } from "@/lib/export";
type Source = {
  id: string;
  file: File;
  url: string;
  duration: number;
  width: number;
  height: number;
};
function Range({
  label,
  value,
  min,
  max,
  step = 0.01,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="range">
      <span>
        {label}
        <b>{Number(value.toFixed(3))}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
const size = (n: number) => (n / 1048576).toFixed(1) + " МБ";
const stateText = {
  queued: "В очереди",
  running: "Обработка",
  done: "Проверено",
  error: "Ошибка",
  cancelled: "Отменено",
};
function errorText(e: unknown) {
  const text = e instanceof Error ? e.message : String(e);
  return /out of memory|memory access|allocation|Aborted|terminated/i.test(text)
    ? "Обработка прервана или не хватает памяти. Включите экономичный режим, уменьшите разрешение и повторите задачу."
    : text;
}
async function sourceInfo(file: File): Promise<Omit<Source, "id">> {
  const url = URL.createObjectURL(file),
    v = document.createElement("video");
  v.preload = "metadata";
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            Error("Браузер не смог прочитать видео. Попробуйте MP4 H.264."),
          ),
        15000,
      );
      v.onloadedmetadata = () => {
        clearTimeout(timer);
        if (
          !Number.isFinite(v.duration) ||
          v.duration <= 0 ||
          v.duration > 600 ||
          !v.videoWidth
        ) {
          reject(Error("Нужно видео длительностью до 10 минут"));
          return;
        }
        resolve({
          file,
          url,
          duration: v.duration,
          width: v.videoWidth,
          height: v.videoHeight,
        });
      };
      v.onerror = () => {
        clearTimeout(timer);
        reject(
          Error("Повреждённый файл или неподдерживаемый кодек: " + file.name),
        );
      };
      v.src = url;
    });
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  } finally {
    v.removeAttribute("src");
    v.load();
  }
}
export default function Home() {
  const [sources, setSources] = useState<Source[]>([]),
    [tasks, setTasks] = useState<Task[]>([]),
    [s, setS] = useState<Settings>(defaults),
    [tab, setTab] = useState("video"),
    [scope, setScope] = useState(""),
    [ready, setReady] = useState(false),
    [running, setRunning] = useState(false),
    [zipBusy, setZipBusy] = useState(false),
    [status, setStatus] = useState("Загрузите видео и создайте очередь"),
    [stage, setStage] = useState(0),
    [notice, setNotice] = useState(""),
    [selected, setSelected] = useState(""),
    [preview, setPreview] = useState(""),
    [reportId, setReportId] = useState(""),
    [subtitleText, setSubtitleText] = useState(""),
    [hookTopic, setHookTopic] = useState(""),
    [economy, setEconomy] = useState(false),
    [shareFile, setShareFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null),
    engine = useRef<Engine | null>(null),
    cancel = useRef(false),
    activeTasks = useRef<Task[]>([]),
    sourceRef = useRef<Source[]>([]),
    previewRef = useRef(""),
    runLock = useRef(false),
    planLock = useRef(false),
    addLock = useRef(false);
  activeTasks.current = tasks;
  sourceRef.current = sources;
  useEffect(() => {
    let live = true;
    const boot = async () => {
      try {
        const stored = localStorage.getItem("vus-settings");
        if (stored) setS(validateSettings(JSON.parse(stored)));
      } catch {}
      try {
        const all = await listTasks();
        const fixed = all.map((t) =>
          t.state === "running"
            ? {
                ...t,
                state: "error" as const,
                error:
                  "Вкладка была закрыта во время обработки. Нажмите «Повторить».",
              }
            : t,
        );
        for (const t of fixed.filter(
          (t) =>
            t.state === "error" &&
            all.find((a) => a.id === t.id)?.state === "running",
        ))
          await saveTask(t);
        if (live) setTasks(fixed.sort((a, b) => a.created - b.created));
        const restored: Source[] = [];
        for (const saved of (await listSources()).slice(0, 50)) {
          if (!live) break;
          try {
            const meta = await sourceInfo(saved.file);
            if (live) restored.push({ id: saved.id, ...meta });
            else URL.revokeObjectURL(meta.url);
          } catch {}
        }
        if (live) {
          setSources(restored);
          setSelected(restored[0]?.id || "");
        }
      } catch (e) {
        if (live) setNotice(errorText(e));
      }
      if (live) {
        setReady(true);
        setEconomy(/iPhone|iPad|Android/i.test(navigator.userAgent));
      }
    };
    void boot();
    return () => {
      live = false;
      cancel.current = true;
      engine.current?.destroy();
      sourceRef.current.forEach((x) => URL.revokeObjectURL(x.url));
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);
  useEffect(() => {
    if (ready)
      try {
        localStorage.setItem("vus-settings", JSON.stringify(s));
      } catch {}
  }, [s, ready]);
  useEffect(() => {
    if (!running && !zipBusy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running, zipBusy]);
  const scoped = tasks.find((t) => t.id === scope),
    cfg = scoped?.settings || s,
    busy = running || zipBusy;
  async function update(next: Settings) {
    if (scope && scoped) {
      const changed = {
        ...scoped,
        settings: next,
        state: "queued" as const,
        error: undefined,
      };
      try {
        await saveTask(changed);
        setTasks((p) => p.map((t) => (t.id === scope ? changed : t)));
      } catch (e) {
        setNotice(errorText(e));
      }
    } else setS(next);
  }
  const change = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    void update({ ...cfg, [key]: value });
  async function put(t: Task) {
    await saveTask(t);
    setTasks((p) =>
      p.some((x) => x.id === t.id)
        ? p.map((x) => (x.id === t.id ? t : x))
        : [...p, t],
    );
  }
  async function add(files: FileList | File[]) {
    if (busy || addLock.current) return;
    addLock.current = true;
    setNotice("");
    try {
      for (const file of Array.from(files)) {
        try {
          if (sourceRef.current.length >= 50)
            throw Error("Максимум 50 исходных видео");
          if (file.size === 0 || file.size > (economy ? 100 : 250) * 1048576)
            throw Error(
              `Файл ${file.name} должен быть меньше ${economy ? 100 : 250} МБ`,
            );
          if (
            !/\.(mp4|mov|webm|m4v)$/i.test(file.name) &&
            !file.type.startsWith("video/")
          )
            throw Error("Нужен MP4, MOV или WebM");
          await ensureSpace(file.size);
          const item = { id: crypto.randomUUID(), ...(await sourceInfo(file)) };
          await saveSource(item.id, file);
          sourceRef.current = [...sourceRef.current, item];
          setSources([...sourceRef.current]);
          setSelected(item.id);
        } catch (e) {
          setNotice(errorText(e));
        }
      }
    } finally {
      addLock.current = false;
    }
  }
  async function plan() {
    if (busy || !sources.length || planLock.current) return;
    planLock.current = true;
    try {
      for (const task of createPlan(sources, s, activeTasks.current, economy))
        await put(task);
      setStatus("Очередь создана. Можно настроить каждый вариант отдельно.");
    } catch (e) {
      setNotice(errorText(e));
    } finally {
      planLock.current = false;
    }
  }
  async function run() {
    if (runLock.current || !ready) return;
    const queue = activeTasks.current.filter(
      (t) => t.state === "queued" && !t.sourceDeleted,
    );
    if (!queue.length) {
      setNotice("Сначала создайте очередь.");
      return;
    }
    runLock.current = true;
    setRunning(true);
    cancel.current = false;
    setScope("");
    setNotice("");
    try {
      for (const task of queue) {
        if (cancel.current) break;
        let job: Task = { ...task, state: "running", error: undefined };
        await put(job);
        try {
          const file = await getSource(job.sourceId);
          if (!file)
            throw Error(
              "Исходник отсутствует в хранилище браузера. Загрузите его заново и создайте новую задачу.",
            );
          await ensureSpace(Math.max(file.size * 2, 16 * 1048576));
          const observer = {
            stage: (name: string, p: number) => {
              setStatus(`${job.sourceName} · вариант ${job.variant}: ${name}`);
              setStage(p);
            },
            progress: (p: number) => setStage(Math.round(5 + 70 * p)),
          };
          if (!engine.current)
            engine.current = await createEngine(observer, () => cancel.current);
          else {
            engine.current.destroy();
            engine.current = await createEngine(observer, () => cancel.current);
          }
          const result = await processVideo(
            engine.current,
            file,
            validateSettings(job.settings),
            job.index,
            observer,
          );
          if (cancel.current) throw Error("Обработка отменена");
          job = {
            ...job,
            state: "done",
            output: result.blob,
            name: result.name,
            report: result.report,
            settings: result.report.settings,
          };
          await put(job);
        } catch (e) {
          job = {
            ...job,
            state: cancel.current ? "cancelled" : "error",
            error: cancel.current
              ? "Отменено пользователем. Можно повторить."
              : errorText(e),
          };
          await put(job);
        } finally {
          engine.current?.destroy();
          engine.current = null;
        }
      }
      setStatus(
        cancel.current
          ? "Обработка остановлена. Остальные задачи сохранены в очереди."
          : "Очередь обработана. Проверьте статусы результатов.",
      );
    } catch (e) {
      setNotice(errorText(e));
    } finally {
      engine.current?.destroy();
      engine.current = null;
      runLock.current = false;
      setRunning(false);
      setStage(0);
    }
  }
  async function removeReference(source: Source) {
    if (busy || runLock.current || planLock.current) return;
    try {
      const detached = await deleteReference(source.id);
      const changes = new Map(detached.map((t) => [t.id, t]));
      const remaining = sourceRef.current.filter((x) => x.id !== source.id);
      sourceRef.current = remaining;
      setSources(remaining);
      setTasks((p) => p.map((t) => changes.get(t.id) || t));
      URL.revokeObjectURL(source.url);
      if (selected === source.id) setSelected(remaining[0]?.id || "");
      if (scoped?.sourceId === source.id) setScope("");
      setNotice("");
      setStatus(
        "Эталон удалён из хранилища браузера. Готовые результаты сохранены.",
      );
    } catch (error) {
      setNotice(errorText(error));
    }
  }
  async function retry(t: Task) {
    if (t.sourceDeleted) {
      setNotice(
        "Эталон удалён. Загрузите исходник заново и создайте новую задачу.",
      );
      return;
    }
    try {
      await put({ ...t, state: "queued", error: undefined });
      setStatus("Задача снова в очереди. Нажмите «Запустить очередь».");
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  async function removeTask(t: Task) {
    try {
      await deleteTask(t.id);
      setTasks((p) => p.filter((x) => x.id !== t.id));
      if (scope === t.id) setScope("");
      if (reportId === t.id) setReportId("");
      if (
        !sourceRef.current.some((x) => x.id === t.sourceId) &&
        !activeTasks.current.some(
          (x) => x.id !== t.id && x.sourceId === t.sourceId,
        )
      )
        await deleteSource(t.sourceId);
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  function view(t: Task) {
    if (!t.output) return;
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = URL.createObjectURL(t.output);
    setPreview(previewRef.current);
    setReportId(t.id);
    setShareFile(null);
  }
  async function zip() {
    if (busy) return;
    setZipBusy(true);
    cancel.current = false;
    try {
      const good = tasks.filter((t) => t.state === "done" && t.output);
      const entries = good.map((t) => ({ name: t.name!, blob: t.output! }));
      entries.push(
        {
          name: "report.json",
          blob: new Blob([JSON.stringify(reports(tasks), null, 2)], {
            type: "application/json",
          }),
        },
        {
          name: "report.csv",
          blob: new Blob([csv(tasks)], { type: "text/csv;charset=utf-8" }),
        },
      );
      const total = entries.reduce((n, x) => n + x.blob.size, 0);
      if (economy && total > 128 * 1048576)
        throw Error(
          "В экономичном режиме ZIP ограничен 128 МБ. Скачайте отдельные файлы или уменьшите партию.",
        );
      await ensureSpace(total);
      const blob = await createZip(
        entries,
        (p) => {
          setStatus(`Создание ZIP: ${p.toFixed(0)}%`);
          setStage(p);
        },
        () => cancel.current,
      );
      saveDownload(blob, "Video-Unique-Studio.zip");
      setStatus("ZIP создан");
    } catch (e) {
      setNotice(errorText(e));
    } finally {
      setZipBusy(false);
      setStage(0);
    }
  }
  const report = tasks.find((t) => t.id === reportId)?.report,
    current = sources.find((x) => x.id === selected),
    good = tasks.filter((t) => t.state === "done"),
    completed = tasks.filter((t) =>
      ["done", "error", "cancelled"].includes(t.state),
    ).length;
  return (
    <main className="app">
      <header className="top">
        <div className="brand">
          <span className="brand-icon">
            <Film size={22} />
          </span>
          <div>
            <strong>
              VIDEO UNIQUE <em>STUDIO</em>{" "}
              <span className="version">Advanced 2.0</span>
            </strong>
            <small>
              Обработка, измерение и проверка видео на вашем устройстве
            </small>
          </div>
        </div>
        <div className="header-actions">
          <RuntimeStatus />
          <button
            className="btn ghost"
            disabled={busy}
            onClick={() =>
              saveDownload(
                new Blob([JSON.stringify(cfg, null, 2)], {
                  type: "application/json",
                }),
                "vus-preset.json",
              )
            }
          >
            <Save size={16} />
            Пресет
          </button>
          <label className="btn ghost">
            <FolderOpen size={16} />
            Импорт
            <input
              type="file"
              accept=".json"
              hidden
              disabled={busy}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f)
                  try {
                    await update(validateSettings(JSON.parse(await f.text())));
                  } catch (err) {
                    setNotice(errorText(err));
                  }
              }}
            />
          </label>
        </div>
      </header>
      {notice && (
        <div className="notice error" role="alert">
          <AlertCircle size={18} />
          <span>{notice}</span>
          <button aria-label="Закрыть сообщение" onClick={() => setNotice("")}>
            ×
          </button>
        </div>
      )}
      <section className="layout">
        <aside className="panel left">
          <div className="panel-heading">
            <h2>
              <Film size={17} />
              Исходные видео
            </h2>
            <span className="count">{sources.length}/50</span>
          </div>
          <button
            className="drop"
            disabled={busy || !ready}
            onClick={() => input.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void add(e.dataTransfer.files);
            }}
          >
            <UploadCloud size={30} />
            <b>Добавить видео</b>
            <span>Выбрать или перетащить файлы</span>
            <small>MP4, MOV, WebM · до 10 минут</small>
          </button>
          <input
            aria-label="Исходные видео"
            ref={input}
            type="file"
            hidden
            multiple
            accept="video/mp4,video/quicktime,video/webm,.mov,.m4v"
            onChange={(e) => {
              if (e.target.files) void add(e.target.files);
              e.target.value = "";
            }}
          />
          <label className="switch economy">
            <span>Экономичный режим</span>
            <input
              type="checkbox"
              checked={economy}
              disabled={busy}
              onChange={(e) => setEconomy(e.target.checked)}
            />
          </label>
          <p className="small-help">
            {economy
              ? "До 100 МБ на исходник. Новые варианты ограничиваются шириной 720 px."
              : "До 250 МБ на исходник. Обработка по одному варианту."}
          </p>
          <div className="file-list">
            {sources.map((i) => (
              <div
                key={i.id}
                className={"file " + (selected === i.id ? "active" : "")}
              >
                <button
                  className="source-select"
                  onClick={() => {
                    setSelected(i.id);
                    setPreview("");
                    setReportId("");
                  }}
                >
                  <Film size={18} />
                  <span className="file-text">
                    <b>{i.file.name}</b>
                    <small>
                      {i.duration.toFixed(2)} с · {i.width}×{i.height} ·{" "}
                      {size(i.file.size)}
                    </small>
                  </span>
                </button>
                <button
                  aria-label={"Удалить эталон " + i.file.name}
                  title="Удалить исходное видео из хранилища браузера"
                  className="btn small ghost delete-reference"
                  disabled={busy}
                  onClick={() => void removeReference(i)}
                >
                  <Trash2 size={15} /> Удалить эталон
                </button>
              </div>
            ))}
          </div>
          <p className="small-help">
            Исходное видео служит эталоном для сравнения. Кнопка «Удалить
            эталон» удаляет его из хранилища; готовые результаты сохраняются.
            Очередь, исходники и результаты сохраняются в этом браузере.
            Закрытие вкладки прерывает текущую задачу; её можно повторить. Не
            очищайте данные сайта до скачивания.
          </p>
        </aside>
        <section className="middle">
          <div className="panel viewer">
            <div className="panel-heading">
              <h2>
                <Play size={17} />
                Предпросмотр
              </h2>
              <span className="hint">
                {preview ? "Проверенный результат" : "Оригинал"}
              </span>
            </div>
            <div className="screen">
              {preview || current ? (
                <video
                  key={preview || current?.url}
                  src={preview || current?.url}
                  controls
                  playsInline
                  onError={() =>
                    setNotice(
                      "Плеер не смог открыть файл. Попробуйте экспорт MP4 H.264.",
                    )
                  }
                />
              ) : (
                <div className="screen-empty">
                  <Film size={46} />
                  <strong>Загрузите исходное видео</strong>
                  <span>
                    Сначала создайте очередь, затем запустите обработку
                  </span>
                </div>
              )}
            </div>
            <div className="viewer-foot">
              <span>
                {current?.file.name || "Видео остаются на вашем устройстве"}
              </span>
              <span>MP4 · H.264 · AAC</span>
            </div>
            {preview && (
              <div className="queue-actions">
                <button
                  className="btn ghost"
                  onClick={() => {
                    const t = tasks.find((x) => x.id === reportId);
                    if (t?.output) {
                      const file = new File([t.output], t.name!, {
                        type: t.output.type,
                      });
                      if (navigator.canShare?.({ files: [file] }))
                        setShareFile(file);
                      else
                        setNotice(
                          "Передача видео недоступна в этом браузере. Скачайте файл и откройте его через «Файлы».",
                        );
                    }
                  }}
                >
                  Подготовить для Фото
                </button>
                {shareFile && (
                  <button
                    className="btn"
                    onClick={() =>
                      void navigator
                        .share({ files: [shareFile] })
                        .catch((e) => {
                          if (e.name !== "AbortError") setNotice(errorText(e));
                        })
                    }
                  >
                    <Share2 size={16} />
                    Поделиться
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="panel queue">
            <div className="panel-heading">
              <h2>
                <RefreshCw size={17} />
                Очередь
              </h2>
              <span className="hint">
                {completed}/{tasks.length} обработано · {good.length} проверено
              </span>
            </div>
            <p className="status" role="status" aria-live="polite">
              {status}
            </p>
            <div
              className="progress-track"
              role="progressbar"
              aria-label="Прогресс текущего этапа"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(stage)}
            >
              <div style={{ width: stage + "%" }} />
            </div>
            <div className="queue-actions">
              <button
                className="btn"
                disabled={busy || !sources.length || !ready}
                onClick={() => void plan()}
              >
                Создать очередь ({sources.length * s.variations})
              </button>
              <button
                className="btn primary"
                disabled={busy || !tasks.some((t) => t.state === "queued")}
                onClick={() => void run()}
              >
                <Play size={16} />
                Запустить очередь
              </button>
              <button
                className="btn danger"
                disabled={!busy}
                onClick={() => {
                  cancel.current = true;
                  engine.current?.destroy();
                  engine.current = null;
                  setStatus("Отмена текущей операции…");
                }}
              >
                <Square size={16} />
                Отмена
              </button>
            </div>
            <div className="task-list">
              {tasks.map((t) => (
                <div className={"task " + t.state} key={t.id}>
                  <div>
                    <strong>
                      {t.name || `${t.sourceName} · v${t.variant}`}
                    </strong>
                    <span className="task-state">
                      {t.state === "done" ? (
                        <CheckCircle2 size={14} />
                      ) : t.state === "error" ? (
                        <AlertCircle size={14} />
                      ) : null}
                      {stateText[t.state]}
                      {t.output ? " · " + size(t.output.size) : ""}
                    </span>
                    {t.error && <p className="task-error">{t.error}</p>}
                    {t.sourceDeleted && t.state === "done" && (
                      <small>Эталон удалён · готовый результат сохранён</small>
                    )}
                    {t.report?.analysis && (
                      <small>
                        MAE {t.report.analysis.mae.toFixed(2)}/255 · SSIM{" "}
                        {t.report.analysis.ssim.toFixed(4)} · pHash{" "}
                        {t.report.analysis.hashDistance.toFixed(1)}/64
                      </small>
                    )}
                  </div>
                  <div className="result-buttons">
                    {t.state === "done" && (
                      <>
                        <button
                          className="btn small ghost"
                          onClick={() => view(t)}
                        >
                          Смотреть / анализ
                        </button>
                        <button
                          className="btn small"
                          onClick={() => saveDownload(t.output!, t.name!)}
                        >
                          <Download size={14} />
                          Скачать
                        </button>
                      </>
                    )}
                    {["error", "cancelled"].includes(t.state) && (
                      <button
                        className="btn small"
                        disabled={busy || t.sourceDeleted}
                        title={
                          t.sourceDeleted
                            ? "Загрузите эталон заново и создайте новую задачу"
                            : undefined
                        }
                        onClick={() => void retry(t)}
                      >
                        Повторить
                      </button>
                    )}
                    {t.state !== "done" && (
                      <button
                        className="btn small ghost"
                        disabled={busy || t.sourceDeleted}
                        onClick={() => setScope(t.id)}
                      >
                        Настроить
                      </button>
                    )}
                    <button
                      className="icon-btn"
                      aria-label={
                        "Удалить вариант " + t.variant + " " + t.sourceName
                      }
                      disabled={busy}
                      onClick={() => void removeTask(t)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {report && (
            <section className="panel analysis">
              <div className="panel-heading">
                <h2>
                  <Activity size={17} />
                  Анализ результата
                </h2>
                <button
                  className="btn small"
                  onClick={() =>
                    saveDownload(
                      new Blob([JSON.stringify(report, null, 2)], {
                        type: "application/json",
                      }),
                      "analysis.json",
                    )
                  }
                >
                  JSON
                </button>
              </div>
              <div className="analysis-body">
                <div className="metric-grid">
                  <div>
                    <small>Кадры</small>
                    <b>{report.checks.frames}</b>
                    <span>
                      {report.timeline.deltaFrames >= 0 ? "+" : ""}
                      {report.timeline.deltaFrames} к нормализованному оригиналу
                    </span>
                  </div>
                  <div>
                    <small>Длительность</small>
                    <b>{report.timeline.duration.toFixed(3)} с</b>
                    <span>
                      {report.timeline.deltaSeconds.toFixed(3)} с изменения
                    </span>
                  </div>
                  {report.analysis && (
                    <>
                      <div>
                        <small>MAE / 255</small>
                        <b>{report.analysis.mae.toFixed(3)}</b>
                        <span>Ориентир 7–8; качество важнее попадания</span>
                      </div>
                      <div>
                        <small>SSIM</small>
                        <b>{report.analysis.ssim.toFixed(4)}</b>
                        <span>Локальные блоки 8×8, яркость</span>
                      </div>
                      <div>
                        <small>pHash</small>
                        <b>{report.analysis.hashDistance.toFixed(2)} / 64</b>
                        <span>Среднее расстояние Хэмминга</span>
                      </div>
                    </>
                  )}
                </div>
                <p className="small-help">
                  Полное декодирование: пройдено · воспроизведение в этом
                  браузере: проверено · faststart:{" "}
                  {report.checks.fastStart ? "да" : "не применимо"}. Профиль
                  iPhone проверяется по кодекам; воспроизведение на конкретном
                  устройстве проверяйте на нём.
                </p>
                {report.analysis && (
                  <>
                    <div className="heatmap">
                      <img
                        src={report.analysis.heatmap}
                        alt="Карта абсолютных различий пикселей центральной пары кадров"
                      />
                      <p>
                        Карта различий среднего по времени кадра. Сравнение{" "}
                        {report.analysis.samples.length} пар RGB24{" "}
                        {report.analysis.width}×{report.analysis.height};
                        исходник выровнен по обрезке, отражению и времени с
                        учётом скорости. Замороженный хвост не участвует. MAE и
                        SSIM не оценивают вероятность распознавания дубликатов.
                      </p>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Время результата</th>
                            <th>Время исходника</th>
                            <th>MAE</th>
                            <th>SSIM</th>
                            <th>pHash</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.analysis.samples.map((x, i) => (
                            <tr key={i}>
                              <td>{x.time.toFixed(3)} с</td>
                              <td>{x.sourceTime.toFixed(3)} с</td>
                              <td>{x.mae.toFixed(3)}</td>
                              <td>{x.ssim.toFixed(4)}</td>
                              <td>{x.hashDistance}/64</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                {report.warnings.map((w, i) => (
                  <p className="notice" key={i}>
                    {w}
                  </p>
                ))}
                <details>
                  <summary>Метаданные после экспорта</summary>
                  <pre>{JSON.stringify(report.metadata, null, 2)}</pre>
                </details>
              </div>
            </section>
          )}
          <div className="panel">
            <div className="panel-heading">
              <h2>Экспорт партии</h2>
              <span className="hint">{good.length} проверенных файлов</span>
            </div>
            <div className="queue-actions">
              <button
                className="btn"
                disabled={busy || !good.length}
                onClick={() => void zip()}
              >
                <FileArchive size={16} />
                Скачать ZIP
              </button>
              <button
                className="btn ghost"
                disabled={!tasks.length}
                onClick={() =>
                  saveDownload(
                    new Blob([csv(tasks)], { type: "text/csv;charset=utf-8" }),
                    "report.csv",
                  )
                }
              >
                Отчёт CSV
              </button>
              <button
                className="btn ghost"
                disabled={!tasks.length}
                onClick={() =>
                  saveDownload(
                    new Blob([JSON.stringify(reports(tasks), null, 2)], {
                      type: "application/json",
                    }),
                    "report.json",
                  )
                }
              >
                Отчёт JSON
              </button>
            </div>
          </div>
        </section>
        <aside className="panel right">
          <div className="panel-heading">
            <h2>
              <SlidersHorizontal size={17} />
              {scoped ? `Вариант ${scoped.variant}` : "Общие настройки"}
            </h2>
            <button
              className="reset"
              disabled={busy}
              onClick={() => void update(defaults)}
            >
              Сбросить
            </button>
          </div>
          {scoped && (
            <div className="notice">
              {scoped.sourceName}
              <button className="btn small" onClick={() => setScope("")}>
                К общим
              </button>
            </div>
          )}
          <div className="tabs" role="tablist" aria-label="Настройки">
            {[
              ["video", "Видео"],
              ["audio", "Звук"],
              ["text", "Текст"],
              ["export", "Экспорт"],
            ].map(([id, label]) => (
              <button
                role="tab"
                aria-selected={tab === id}
                key={id}
                className={tab === id ? "active" : ""}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <fieldset className="settings-scroll" disabled={busy}>
            {tab === "video" && (
              <>
                <h3>Профиль изображения</h3>
                <div className="actions" aria-label="Профили изображения">
                  {(Object.keys(visualPresets) as VisualPreset[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      className="btn small"
                      onClick={() => void update(applyVisualPreset(cfg, key))}
                    >
                      {visualPresets[key].label}
                    </button>
                  ))}
                </div>
                <p className="notice">
                  {hasVisualEffects(cfg)
                    ? "Визуальная обработка включена. Точные параметры указаны ниже; изменения можно настроить вручную. Профили не гарантируют оригинальность или попадание в рекомендации."
                    : "Визуальные эффекты выключены: изображение в основном сохранится при перекодировании. Для коррекции выберите профиль или измените параметры ниже."}
                </p>
                <details>
                  <summary>Что меняют профили</summary>
                  {Object.values(visualPresets).map((preset) => (
                    <p key={preset.label}>
                      <b>{preset.label}:</b> {preset.description}
                    </p>
                  ))}
                  <p>
                    Профиль задаёт цвет и кадрирование и выключает случайные
                    эффекты. Скорость, звук, текст и формат сохраняют выбранные
                    настройки. Существующие задачи меняются только при
                    редактировании выбранного варианта.
                  </p>
                </details>
                <h3>Временная шкала</h3>
                <Range
                  label="Скорость"
                  value={cfg.speed}
                  min={0.85}
                  max={1.25}
                  onChange={(v) => change("speed", v)}
                />
                <label className="switch">
                  <span>Вариация длительности ±0,2–0,9 с</span>
                  <input
                    type="checkbox"
                    checked={cfg.durationVariation}
                    onChange={(e) =>
                      change("durationVariation", e.target.checked)
                    }
                  />
                </label>
                <label className="switch">
                  <span>Вариация количества кадров</span>
                  <input
                    type="checkbox"
                    checked={cfg.frameVariation}
                    onChange={(e) => change("frameVariation", e.target.checked)}
                  />
                </label>
                {cfg.frameVariation && (
                  <div className="fields-pair">
                    <label className="field">
                      Минимум кадров
                      <input
                        type="number"
                        min={6}
                        max={27}
                        value={cfg.frameMin}
                        onChange={(e) =>
                          change("frameMin", Number(e.target.value))
                        }
                      />
                    </label>
                    <label className="field">
                      Максимум кадров
                      <input
                        type="number"
                        min={6}
                        max={27}
                        value={cfg.frameMax}
                        onChange={(e) =>
                          change("frameMax", Number(e.target.value))
                        }
                      />
                    </label>
                  </div>
                )}
                <p className="small-help">
                  Один согласованный сдвиг временной шкалы. При удлинении
                  добавляется неподвижный хвост и тишина; при сокращении
                  обрезается конец. Итоговое количество кадров проверяется
                  декодированием.
                </p>
                <h3>Smart Crop</h3>
                <Range
                  label="Масштаб"
                  value={cfg.zoom}
                  min={1}
                  max={1.12}
                  step={0.005}
                  onChange={(v) => change("zoom", v)}
                />
                <Range
                  label="Фокус обрезки X, %"
                  value={cfg.cropX}
                  min={0}
                  max={100}
                  step={1}
                  onChange={(v) => change("cropX", v)}
                />
                <Range
                  label="Фокус обрезки Y, %"
                  value={cfg.cropY}
                  min={0}
                  max={100}
                  step={1}
                  onChange={(v) => change("cropY", v)}
                />
                <p className="small-help">
                  Сохраняет соотношение сторон. Положение объекта задаётся
                  фокусом; автоматического распознавания лиц нет.
                </p>
                <label className="switch">
                  <span>Отражение по горизонтали</span>
                  <input
                    type="checkbox"
                    checked={cfg.flip}
                    onChange={(e) => change("flip", e.target.checked)}
                  />
                </label>
                <h3>Pixel Variation и цвет</h3>
                <Range
                  label="Яркость"
                  value={cfg.brightness}
                  min={-0.1}
                  max={0.1}
                  step={0.005}
                  onChange={(v) => change("brightness", v)}
                />
                <Range
                  label="Контраст"
                  value={cfg.contrast}
                  min={0.85}
                  max={1.15}
                  onChange={(v) => change("contrast", v)}
                />
                <Range
                  label="Насыщенность"
                  value={cfg.saturation}
                  min={0.8}
                  max={1.2}
                  onChange={(v) => change("saturation", v)}
                />
                <Range
                  label="Оттенок, °"
                  value={cfg.hue}
                  min={-25}
                  max={25}
                  step={1}
                  onChange={(v) => change("hue", v)}
                />
                <Range
                  label="Зерно"
                  value={cfg.noise}
                  min={0}
                  max={12}
                  step={0.5}
                  onChange={(v) => change("noise", v)}
                />
                <label className="switch">
                  <span>Виньетка</span>
                  <input
                    type="checkbox"
                    checked={cfg.vignette}
                    onChange={(e) => change("vignette", e.target.checked)}
                  />
                </label>
                <h3>Новые варианты</h3>
                <label className="field">
                  Вариантов на исходник (1–50)
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={cfg.variations}
                    onChange={(e) =>
                      change("variations", Number(e.target.value))
                    }
                  />
                </label>
                <label className="switch">
                  <span>Независимая рандомизация</span>
                  <input
                    type="checkbox"
                    checked={cfg.auto}
                    onChange={(e) => change("auto", e.target.checked)}
                  />
                </label>
                {cfg.auto && (
                  <>
                    <label className="field">
                      Интенсивность
                      <select
                        value={cfg.strength}
                        onChange={(e) =>
                          change(
                            "strength",
                            e.target.value as Settings["strength"],
                          )
                        }
                      >
                        <option value="light">Лёгкая</option>
                        <option value="medium">Средняя</option>
                        <option value="strong">Выраженная</option>
                      </select>
                    </label>
                    <label className="field">
                      Seed
                      <input
                        type="number"
                        value={cfg.seed}
                        min={0}
                        max={4294967295}
                        onChange={(e) => change("seed", Number(e.target.value))}
                      />
                    </label>
                  </>
                )}
              </>
            )}
            {tab === "audio" && (
              <>
                <h3>Обработка звука</h3>
                <label className="switch">
                  <span>Без звука</span>
                  <input
                    type="checkbox"
                    checked={cfg.mute}
                    onChange={(e) => change("mute", e.target.checked)}
                  />
                </label>
                <Range
                  label="Громкость, ×"
                  value={cfg.volume}
                  min={0}
                  max={2}
                  step={0.05}
                  onChange={(v) => change("volume", v)}
                />
                <label className="switch">
                  <span>Нормализация −16 LUFS</span>
                  <input
                    type="checkbox"
                    checked={cfg.audioNormalize}
                    onChange={(e) => change("audioNormalize", e.target.checked)}
                  />
                </label>
                <label className="switch">
                  <span>Плавное начало и окончание</span>
                  <input
                    type="checkbox"
                    checked={cfg.fadeAudio}
                    onChange={(e) => change("fadeAudio", e.target.checked)}
                  />
                </label>
                <p className="notice">
                  Темп синхронизируется со скоростью видео. Исходник без аудио
                  обрабатывается без ошибки.
                </p>
              </>
            )}
            {tab === "text" && (
              <>
                <h3>Hook Generator</h3>
                <label className="field">
                  Тема
                  <input
                    value={hookTopic}
                    onChange={(e) => setHookTopic(e.target.value)}
                    maxLength={100}
                    placeholder="Например, монтаж видео"
                  />
                </label>
                <button
                  className="btn ghost"
                  onClick={() => {
                    const topic = hookTopic.trim();
                    if (!topic) {
                      setNotice("Введите тему вступления");
                      return;
                    }
                    const templates = [
                      `Что важно знать: ${topic}`,
                      `${topic}: смотрите до конца`,
                      `${topic} — разберём на примере`,
                    ];
                    change(
                      "hook",
                      templates[Math.floor(Math.random() * templates.length)],
                    );
                  }}
                >
                  Создать вступление
                </button>
                <label className="field">
                  Текст вступления
                  <input
                    value={cfg.hook}
                    maxLength={200}
                    onChange={(e) => change("hook", e.target.value)}
                  />
                </label>
                <Range
                  label="Вступление, секунд"
                  value={cfg.hookSeconds}
                  min={0.5}
                  max={10}
                  step={0.5}
                  onChange={(v) => change("hookSeconds", v)}
                />
                <h3>Надпись на всём видео</h3>
                <label className="field">
                  Текст
                  <input
                    value={cfg.overlay}
                    maxLength={300}
                    onChange={(e) => change("overlay", e.target.value)}
                  />
                </label>
                <Range
                  label="Размер при ширине 1080, px"
                  value={cfg.overlaySize}
                  min={16}
                  max={96}
                  step={1}
                  onChange={(v) => change("overlaySize", v)}
                />
                <Range
                  label="Позиция X, %"
                  value={cfg.overlayX}
                  min={5}
                  max={95}
                  step={1}
                  onChange={(v) => change("overlayX", v)}
                />
                <Range
                  label="Позиция Y, %"
                  value={cfg.overlayY}
                  min={5}
                  max={95}
                  step={1}
                  onChange={(v) => change("overlayY", v)}
                />
                <h3>Генератор субтитров из текста</h3>
                <label className="field">
                  Одна реплика в строке
                  <textarea
                    rows={4}
                    value={subtitleText}
                    onChange={(e) => setSubtitleText(e.target.value)}
                  />
                </label>
                <button
                  className="btn ghost"
                  onClick={() => {
                    if (!current) {
                      setNotice("Выберите исходное видео");
                      return;
                    }
                    change(
                      "subtitles",
                      generateSrt(subtitleText, current.duration),
                    );
                  }}
                >
                  Распределить по времени
                </button>
                <p className="small-help">
                  Генератор создаёт тайминги для введённого текста.
                  Распознавание речи не подключено.
                </p>
                <label className="field">
                  SRT / WebVTT
                  <textarea
                    rows={7}
                    value={cfg.subtitles}
                    onChange={(e) => change("subtitles", e.target.value)}
                  />
                </label>
                <label className="field">
                  Импорт субтитров
                  <input
                    type="file"
                    accept=".srt,.vtt"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) change("subtitles", await f.text());
                      e.target.value = "";
                    }}
                  />
                </label>
                <p className="small-help">
                  {parseSrt(cfg.subtitles).length} реплик. Субтитры встраиваются
                  в кадры. Тайминги относятся к исходному видео и учитывают
                  скорость.
                </p>
              </>
            )}
            {tab === "export" && (
              <>
                <h3>Совместимость и качество</h3>
                <label className="field">
                  Формат
                  <select
                    value={cfg.format}
                    onChange={(e) =>
                      change("format", e.target.value as Settings["format"])
                    }
                  >
                    <option value="mp4">MP4 · H.264 / AAC-LC · iPhone</option>
                    <option value="webm">WebM · VP9 / Opus</option>
                  </select>
                </label>
                <label className="field">
                  Размер
                  <select
                    value={cfg.resolution}
                    onChange={(e) =>
                      change(
                        "resolution",
                        e.target.value as Settings["resolution"],
                      )
                    }
                  >
                    <option value="original">Исходное разрешение</option>
                    <option value="720">Ширина 720 px</option>
                    <option value="1080">Ширина 1080 px</option>
                  </select>
                </label>
                <label className="field">
                  FPS
                  <select
                    value={cfg.fps}
                    onChange={(e) => change("fps", Number(e.target.value))}
                  >
                    {[24, 25, 30, 60].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <label className="switch">
                  <span>Adaptive Encoding</span>
                  <input
                    type="checkbox"
                    checked={cfg.adaptive}
                    onChange={(e) => change("adaptive", e.target.checked)}
                  />
                </label>
                {!cfg.adaptive && (
                  <Range
                    label="CRF (меньше — выше качество)"
                    value={cfg.crf}
                    min={18}
                    max={28}
                    step={1}
                    onChange={(v) => change("crf", v)}
                  />
                )}
                <h3>Финальная очистка метаданных</h3>
                <label className="field">
                  Режим
                  <select
                    value={cfg.metadata}
                    onChange={(e) =>
                      change("metadata", e.target.value as Settings["metadata"])
                    }
                  >
                    <option value="strip">Удалить необязательные поля</option>
                    <option value="keep">Сохранить доступные поля</option>
                  </select>
                </label>
                {cfg.metadata === "keep" && (
                  <label className="field">
                    Заголовок
                    <input
                      value={cfg.title}
                      maxLength={200}
                      onChange={(e) => change("title", e.target.value)}
                    />
                  </label>
                )}
                <p className="small-help">
                  Очистка MP4 выполняется после кодирования. Обязательные данные
                  декодирования сохраняются. Оставшиеся поля видны в отчёте.
                </p>
                <h3>Анализ и контроль</h3>
                <label className="switch">
                  <span>MAE / SSIM / pHash и карта</span>
                  <input
                    type="checkbox"
                    checked={cfg.analysis}
                    onChange={(e) => change("analysis", e.target.checked)}
                  />
                </label>
                <label className="field">
                  Пар кадров
                  <select
                    value={cfg.analysisSamples}
                    onChange={(e) =>
                      change("analysisSamples", Number(e.target.value))
                    }
                  >
                    {[3, 5, 7, 9].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <label className="switch">
                  <span>Снизить эффект при SSIM &lt; 0.75</span>
                  <input
                    type="checkbox"
                    checked={cfg.qualityRetry}
                    onChange={(e) => change("qualityRetry", e.target.checked)}
                  />
                </label>
                <p className="small-help">
                  Один повтор из оригинала, без повторного сжатия результата.
                  При текстовых наложениях автоматический повтор отключён.
                  Декодирование и проверка воспроизведения обязательны.
                </p>
              </>
            )}
          </fieldset>
        </aside>
      </section>
      <footer>
        Video Unique Studio Advanced 2.0 · Не закрывайте вкладку во время
        обработки · Результаты проверяются перед скачиванием
      </footer>
    </main>
  );
}
