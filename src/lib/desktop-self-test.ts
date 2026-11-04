import { createEngine, processVideo } from "./pipeline";
import { defaults } from "./processing";
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
    const fixture = await bridge.selfTestFixture();
    const file = new File([new Uint8Array(fixture)], "desktop-check.mp4", {
      type: "video/mp4",
    });
    engine = await createEngine(
      { stage: () => {}, progress: () => {} },
      () => false,
    );
    const settings = {
      ...defaults,
      speed: 1.05,
      durationVariation: true,
      frameVariation: true,
      overlay: "Windows FFmpeg",
      subtitles: "1\n00:00:00,100 --> 00:00:01,000\nПроверка субтитров",
      analysisSamples: 3,
      audioNormalize: true,
    };
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
