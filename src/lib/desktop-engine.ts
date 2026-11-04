import type { Engine, Observer, EngineFiles } from "./pipeline";
export type DesktopStatus = {
  phase: string;
  message: string;
  error?: string;
  percent?: number | null;
  received?: number;
  total?: number;
  selfTest?: boolean;
  tools?: { version: string; source: string; ffmpeg: string };
};
export type DesktopBridge = {
  version: string;
  getStatus: () => Promise<DesktopStatus>;
  retryTools: () => Promise<void>;
  chooseTools: () => Promise<void>;
  onStatus: (callback: (status: DesktopStatus) => void) => () => void;
  openSession: () => Promise<string>;
  write: (
    id: string,
    name: string,
    data: Uint8Array,
    offset: number,
  ) => Promise<void>;
  stat: (id: string, name: string) => Promise<number>;
  read: (
    id: string,
    name: string,
    offset: number,
    length: number,
    encoding?: string,
  ) => Promise<Uint8Array | string>;
  remove: (id: string, name: string) => Promise<void>;
  run: (
    id: string,
    kind: "ffmpeg" | "ffprobe",
    args: string[],
    timeout: number,
  ) => Promise<number>;
  closeSession: (id: string) => Promise<void>;
  onProgress: (
    callback: (event: { id: string; time: number }) => void,
  ) => () => void;
  openResults: () => Promise<string>;
  selfTestFixture: () => Promise<Uint8Array>;
  selfTestFinish: (result: unknown) => Promise<void>;
};
declare global {
  interface Window {
    videoUniqueDesktop?: DesktopBridge;
  }
}
export async function createDesktopEngine(
  bridge: DesktopBridge,
  observer: Observer,
  isCancelled: () => boolean,
): Promise<Engine> {
  observer.stage("Подключение к FFmpeg для Windows…", 0);
  const id = await bridge.openSession();
  let expected = 0,
    closed = false;
  const unsubscribe = bridge.onProgress((event) => {
    if (event.id === id && expected && Number.isFinite(event.time))
      observer.progress(Math.max(0, Math.min(1, event.time / 1e6 / expected)));
  });
  const ff: EngineFiles = {
    async writeFile(name, data) {
      const bytes =
        typeof data === "string" ? new TextEncoder().encode(data) : data;
      const chunk = 4 * 1024 * 1024;
      if (!bytes.length) await bridge.write(id, name, new Uint8Array(), 0);
      for (let offset = 0; offset < bytes.length; offset += chunk) {
        if (closed || isCancelled()) throw Error("Обработка отменена");
        await bridge.write(
          id,
          name,
          new Uint8Array(bytes.subarray(offset, offset + chunk)),
          offset,
        );
      }
    },
    async readFile(name, encoding) {
      if (encoding === "utf8") return bridge.read(id, name, 0, 0, "utf8");
      const length = await bridge.stat(id, name);
      if (
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > 2 * 1024 * 1024 * 1024
      )
        throw Error("Результат слишком большой");
      const result = new Uint8Array(length),
        chunk = 4 * 1024 * 1024;
      for (let offset = 0; offset < length; offset += chunk) {
        const bytes = await bridge.read(
          id,
          name,
          offset,
          Math.min(chunk, length - offset),
        );
        if (typeof bytes === "string") throw Error("Некорректный блок файла");
        result.set(bytes, offset);
      }
      return result;
    },
    deleteFile: (name) => bridge.remove(id, name),
    ffprobe: (args, timeout = 120000) =>
      bridge.run(id, "ffprobe", args, timeout),
  };
  return {
    ff,
    cancelled: isCancelled,
    destroy() {
      if (closed) return;
      closed = true;
      unsubscribe();
      void bridge.closeSession(id).catch(() => {});
    },
    async run(args, duration = 0) {
      if (closed || isCancelled()) throw Error("Обработка отменена");
      expected = duration;
      try {
        await bridge.run(id, "ffmpeg", args, 600000);
      } finally {
        expected = 0;
      }
    },
  };
}
