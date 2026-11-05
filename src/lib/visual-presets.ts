import type { Settings } from "./processing";

export const visualPresets = {
  neutral: {
    label: "Без эффектов",
    description:
      "Исходные цвет и кадрирование. Экспорт изменяет кодирование и выбранные метаданные.",
    values: { brightness: 0, contrast: 1, saturation: 1, zoom: 1, hue: 0 },
  },
  natural: {
    label: "Мягкая обработка",
    description:
      "Небольшая коррекция цвета и приближение на 1,5%. Проверьте края кадра.",
    values: {
      brightness: 0.008,
      contrast: 1.025,
      saturation: 1.035,
      zoom: 1.015,
      hue: 0,
    },
  },
  vivid: {
    label: "Выраженная обработка",
    description:
      "Более заметная коррекция цвета и приближение на 4%. Проверьте лица, светлые области и края кадра.",
    values: {
      brightness: 0.025,
      contrast: 1.08,
      saturation: 1.08,
      zoom: 1.04,
      hue: 2,
    },
  },
} as const;
export type VisualPreset = keyof typeof visualPresets;

export function applyVisualPreset(s: Settings, preset: VisualPreset): Settings {
  return {
    ...s,
    ...visualPresets[preset].values,
    selectedProfile: preset,
    autoAnalyze: false,
    auto: false,
    noise: 0,
    flip: false,
    vignette: false,
  };
}

export function hasVisualEffects(s: Settings) {
  return (
    s.brightness !== 0 ||
    s.contrast !== 1 ||
    s.saturation !== 1 ||
    s.zoom !== 1 ||
    s.hue !== 0 ||
    s.noise !== 0 ||
    s.flip ||
    s.vignette ||
    !!s.overlay.trim() ||
    !!s.hook.trim() ||
    !!s.subtitles.trim() ||
    s.auto
  );
}

/** Analysis is performed per source, before encoding. No random color changes. */
export function applyAutoPreset(s: Settings): Settings {
  return {
    ...s,
    selectedProfile: "auto",
    autoAnalyze: true,
    auto: false,
    brightness: 0,
    contrast: 1,
    saturation: 1,
    hue: 0,
    noise: 0,
    analysis: true,
    analysisSamples: 9,
    qualityRetry: true,
    adaptive: true,
    format: "mp4",
    metadata: "strip",
  };
}
