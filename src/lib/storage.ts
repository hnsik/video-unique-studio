import type { Settings } from "./processing";
import type { Report } from "./pipeline";
export type Task = {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceDeleted?: boolean;
  variant: number;
  index: number;
  settings: Settings;
  state: "queued" | "running" | "done" | "error" | "cancelled";
  error?: string;
  output?: Blob;
  name?: string;
  report?: Report;
  created: number;
};
let database: Promise<IDBDatabase> | undefined;
function db() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("vus-advanced-2", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("files");
      r.result.createObjectStore("tasks", { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () =>
      reject(
        Error(
          "Не удалось открыть хранилище браузера. Отключите приватный режим или разрешите хранение данных.",
        ),
      );
  }));
}
async function request<T>(
  store: string,
  mode: IDBTransactionMode,
  action: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const d = await db();
  return new Promise<T>((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const r = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(r.result);
    tx.onerror = () =>
      reject(
        Error(
          tx.error?.name === "QuotaExceededError"
            ? "Хранилище браузера заполнено. Скачайте и удалите старые результаты."
            : tx.error?.message || "Ошибка локального хранилища",
        ),
      );
    tx.onabort = () =>
      reject(Error("Браузер прервал сохранение. Проверьте свободное место."));
  });
}
export const saveTask = (t: Task) =>
  request("tasks", "readwrite", (s) => s.put(t));
export const listTasks = () =>
  request<Task[]>("tasks", "readonly", (s) => s.getAll());
export const deleteTask = (id: string) =>
  request("tasks", "readwrite", (s) => s.delete(id));
export const saveSource = (id: string, f: File) =>
  request("files", "readwrite", (s) => s.put(f, id));
export const getSource = (id: string) =>
  request<File | undefined>("files", "readonly", (s) => s.get(id));
export const deleteSource = (id: string) =>
  request("files", "readwrite", (s) => s.delete(id));
export async function ensureSpace(bytes: number) {
  const e = await navigator.storage?.estimate?.();
  if (e?.quota && e.usage !== undefined && e.quota - e.usage < bytes * 1.25)
    throw Error(
      "Недостаточно места в браузере. Удалите старые результаты или уменьшите партию.",
    );
}

export async function listSources() {
  const d = await db();
  return new Promise<{ id: string; file: File }[]>((resolve, reject) => {
    const tx = d.transaction("files", "readonly"),
      store = tx.objectStore("files"),
      keys = store.getAllKeys(),
      files = store.getAll();
    tx.oncomplete = () =>
      resolve(
        files.result.map((file: File, i: number) => ({
          id: String(keys.result[i]),
          file,
        })),
      );
    tx.onerror = () => reject(Error("Не удалось восстановить исходники"));
  });
}

// Remove the original and detach dependent jobs atomically; completed exports remain downloadable.
export async function deleteReference(id: string): Promise<Task[]> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(["files", "tasks"], "readwrite");
    const store = tx.objectStore("tasks");
    const changed: Task[] = [];
    tx.objectStore("files").delete(id);
    const all = store.getAll();
    all.onsuccess = () => {
      for (const task of all.result as Task[]) {
        if (task.sourceId !== id) continue;
        const next: Task = { ...task, sourceDeleted: true };
        if (task.state !== "done") {
          next.state = "cancelled";
          next.error =
            "Эталон удалён. Для новой обработки загрузите исходник заново и создайте новую задачу.";
        }
        store.put(next);
        changed.push(next);
      }
    };
    tx.oncomplete = () => resolve(changed);
    tx.onabort = tx.onerror = () =>
      reject(Error("Не удалось удалить эталон. Повторите попытку."));
  });
}
