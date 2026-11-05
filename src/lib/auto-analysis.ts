import { clamp, type Settings } from "./processing";
export type ImageStats = {
  mean: number;
  p05: number;
  p95: number;
  clippedDark: number;
  clippedLight: number;
  saturation: number;
  pixels: number;
};
export type AutoDecision = {
  before: ImageStats;
  predicted: ImageStats;
  candidates: number;
  reasons: string[];
};
export function imageStats(
  rgb: Uint8Array,
  brightness = 0,
  contrast = 1,
  saturation = 1,
): ImageStats {
  const histogram = new Uint32Array(256);
  let sum = 0,
    dark = 0,
    light = 0,
    sat = 0;
  const pixels = Math.floor(rgb.length / 3);
  if (!pixels) throw Error("Нет кадров для автоматической настройки");
  for (let i = 0; i < pixels * 3; i += 3) {
    const sourceY =
      (0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2]) / 255;
    const y = (sourceY - 0.5) * contrast + 0.5 + brightness;
    const channels = [0, 1, 2].map((k) =>
      clamp(y + (rgb[i + k] / 255 - sourceY) * saturation, 0, 1),
    );
    const measured =
      0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    histogram[Math.round(measured * 255)]++;
    sum += measured;
    if (measured <= 0.02) dark++;
    if (measured >= 0.98) light++;
    const hi = Math.max(...channels),
      lo = Math.min(...channels);
    sat += hi ? (hi - lo) / hi : 0;
  }
  const percentile = (q: number) => {
    let count = 0;
    for (let i = 0; i < 256; i++) {
      count += histogram[i];
      if (count >= pixels * q) return i / 255;
    }
    return 1;
  };
  return {
    mean: sum / pixels,
    p05: percentile(0.05),
    p95: percentile(0.95),
    clippedDark: dark / pixels,
    clippedLight: light / pixels,
    saturation: sat / pixels,
    pixels,
  };
}
export function selectAutoSettings(
  s: Settings,
  rgb: Uint8Array,
): { settings: Settings; decision: AutoDecision } {
  const before = imageStats(rgb);
  // Conservative targets preserve intentionally dark/bright scenes; never force a universal exposure.
  const targetMean = before.mean + clamp(0.46 - before.mean, -0.025, 0.025);
  const targetSat =
    before.saturation + clamp(0.38 - before.saturation, -0.025, 0.025);
  const targetRange = Math.max(
    before.p95 - before.p05,
    Math.min(0.65, before.p95 - before.p05 + 0.025),
  );
  let best = Infinity,
    chosen = { brightness: 0, contrast: 1, saturation: 1 },
    predicted = before,
    candidates = 0;
  for (const brightness of [-0.025, -0.0125, 0, 0.0125, 0.025])
    for (const contrast of [0.96, 1, 1.04])
      for (const saturation of [0.95, 1, 1.05]) {
        const a = imageStats(rgb, brightness, contrast, saturation);
        candidates++;
        if (
          a.clippedDark > before.clippedDark + 0.005 ||
          a.clippedLight > before.clippedLight + 0.005
        )
          continue;
        const score =
          4 * Math.abs(a.mean - targetMean) +
          Math.abs(a.saturation - targetSat) +
          0.5 * Math.abs(a.p95 - a.p05 - targetRange) +
          0.08 *
            (Math.abs(brightness) +
              Math.abs(contrast - 1) +
              Math.abs(saturation - 1));
        if (score < best) {
          best = score;
          chosen = { brightness, contrast, saturation };
          predicted = a;
        }
      }
  const reasons = [
    `Сравнено ${candidates} сочетаний по реальным кадрам: яркость, диапазон тонов, насыщенность.`,
    "Рост доли выбитых светов и глубоких теней ограничен 0,5 процентного пункта в оценочной модели.",
    "Скорость, монтаж и композиция остаются авторским выбором: анализ цвета не определяет лучший сюжет.",
  ];
  return {
    settings: { ...s, ...chosen, hue: 0, noise: 0, auto: false },
    decision: { before, predicted, candidates, reasons },
  };
}
