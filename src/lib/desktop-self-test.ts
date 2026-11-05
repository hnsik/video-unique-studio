import { createEngine, processVideo } from "./pipeline";
import { defaults } from "./processing";
import { applyAutoPreset } from "./visual-presets";
import {
  saveSource,
  saveTask,
  deleteReference,
  getSource,
  listTasks,
} from "./storage";
import type { DesktopBridge } from "./desktop-engine";
export async function desktopSelfTest(bridge: DesktopBridge) {
  let engine: Awaited<ReturnType<typeof createEngine>> | undefined;
  try {
    const until = async (check: () => boolean) => {
      const deadline = Date.now() + 10000;
      while (!check()) {
        if (Date.now() > deadline) throw Error("UI state check timed out");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };
    await until(() => !!document.querySelector("button.auto-button"));
    const autoButton =
      document.querySelector<HTMLButtonElement>("button.auto-button")!;
    autoButton.click();
    await until(() => autoButton.getAttribute("aria-pressed") === "true");
    const natural = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Мягкая обработка"))!;
    natural.click();
    await until(
      () =>
        natural.getAttribute("aria-pressed") === "true" &&
        autoButton.getAttribute("aria-pressed") === "false",
    );
    const fixture = await bridge.selfTestFixture();
    const file = new File([new Uint8Array(fixture)], "desktop-check.mp4", {
      type: "video/mp4",
    });
    engine = await createEngine(
      { stage: () => {}, progress: () => {} },
      () => false,
    );
    const settings = applyAutoPreset({
      ...defaults,
      speed: 1.05,
      segments: "0.5 1.5\n0 0.5",
      zoomKeys: "0 1\n0.7 1.08\n1.2 1",
      durationVariation: true,
      frameVariation: true,
      overlay: "Windows FFmpeg",
      subtitles: "1\n00:00:00,100 --> 00:00:01,000\nПроверка субтитров",
      analysisSamples: 3,
      audioNormalize: true,
    });
    const result = await processVideo(engine, file, settings, 4, {
      stage: () => {},
      progress: () => {},
    });
    const report = result.report,
      v = report.output.streams.find((x) => x.codec_type === "video")!,
      a = report.output.streams.find((x) => x.codec_type === "audio")!;
    if (
      !report.checks.decoded ||
      !report.checks.browserPlayback ||
      !report.analysis ||
      !report.autoDecision ||
      report.autoDecision.candidates !== 45 ||
      Math.abs(Number(a.duration) - report.timeline.duration) > 0.04 ||
      Number(v.nb_read_frames) !== report.timeline.frames
    )
      throw Error("Native export checks failed");
    await saveSource("desktop-check-source", file);
    await saveTask({
      id: "desktop-check-task",
      sourceId: "desktop-check-source",
      sourceName: file.name,
      variant: 1,
      index: 4,
      settings,
      state: "done",
      output: result.blob,
      name: result.name,
      report,
      created: Date.now(),
    });
    await deleteReference("desktop-check-source");
    const saved = (await listTasks()).find(
      (x) => x.id === "desktop-check-task",
    );
    if (
      (await getSource("desktop-check-source")) ||
      !saved?.output ||
      saved.output.size !== result.blob.size ||
      !saved.sourceDeleted
    )
      throw Error("Desktop persistence/deletion check failed");
    engine.destroy();
    await bridge.selfTestFinish({
      ok: true,
      nativeFFmpeg: true,
      visualPreset: "auto-analysis",
      selectedButtonUI: true,
      montageAndZoom: true,
      frames: report.checks.frames,
      videoDuration: Number(v.duration),
      audioDuration: Number(a.duration),
      browserPlayback: true,
      mae: report.analysis.mae,
      ssim: report.analysis.ssim,
      workerMetrics: true,
      referenceDeletion: true,
      preservedOutput: true,
      sha256: report.outputSha256,
    });
  } catch (error) {
    engine?.destroy();
    await bridge.selfTestFinish({
      ok: false,
      error: error instanceof Error ? error.stack : String(error),
    });
  }
}
