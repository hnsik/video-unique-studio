import { randomFor, validateSettings, type Settings } from "./processing";
import type { Task } from "./storage";
export function createPlan(
  sources: {
    id: string;
    file: { name: string };
    width: number;
    height: number;
  }[],
  settings: Settings,
  existing: Task[],
  economy: boolean,
): Task[] {
  const s = validateSettings(settings),
    count = sources.length * s.variations;
  if (count + existing.length > 50)
    throw Error(
      "В очереди может быть до 50 вариантов. Удалите старые задачи или уменьшите число вариантов.",
    );
  const first = existing.reduce((max, t) => Math.max(max, t.index), -1) + 1;
  return sources.flatMap((src, i) =>
    Array.from({ length: s.variations }, (_, j) => {
      const index = first + i * s.variations + j,
        cfg = randomFor(s, index);
      if (economy && src.width > 720 && src.height > 720)
        cfg.resolution = "720";
      return {
        id: crypto.randomUUID(),
        sourceId: src.id,
        sourceName: src.file.name,
        index,
        variant: j + 1,
        settings: cfg,
        state: "queued" as const,
        created: Date.now() + index,
      };
    }),
  );
}
