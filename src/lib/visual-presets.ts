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

/** A bounded editing preset, not an optimizer for a platform's classifier. */
export function applyAutoPreset(s: Settings): Settings {
  const timedText = !!s.subtitles.trim();
  return {
    ...applyVisualPreset(s, "vivid"),
    auto: true,
    strength: "medium",
    speed: timedText ? s.speed : 1.03,
    speedVariation: timedText ? 0 : 0.01,
    brightness: 0.015,
    contrast: 1.05,
    saturation: 1.06,
    zoom: 1.025,
    hue: 0,
    colorVariation: 0.015,
    zoomVariation: 0.01,
    // Speed changes the timeline without adding a frozen tail or cutting the end.
    durationVariation: false,
    frameVariation: false,
    analysis: true,
    analysisSamples: 9,
    qualityRetry: true,
    adaptive: true,
    crf: 21,
    format: "mp4",
    metadata: "strip",
  };
}
