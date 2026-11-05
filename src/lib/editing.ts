/** Edit points are numeric data, never raw FFmpeg expressions. */
export type Segment = { start: number; end: number };
export type ZoomPoint = { time: number; zoom: number };
function rows(text: string) {
  return text.trim()
    ? text
        .trim()
        .split(/\n+/)
        .map((line) =>
          line
            .trim()
            .split(/[;\s]+/)
            .map(Number),
        )
    : [];
}
export function parseSegments(text: string, duration = Infinity): Segment[] {
  const data = rows(text);
  if (data.length > 20) throw Error("Можно выбрать до 20 фрагментов");
  return data.map((row) => {
    const [start, end] = row;
    if (
      row.length !== 2 ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      end > duration + 0.001 ||
      end - start < 0.1
    )
      throw Error(
        "Фрагмент: укажите начало и конец в секундах, минимум 0,1 с, в пределах исходника",
      );
    return { start, end };
  });
}
export function parseZoom(text: string): ZoomPoint[] {
  const data = rows(text);
  if (data.length > 12) throw Error("Можно задать до 12 точек зума");
  return data.map((row, i) => {
    const [time, zoom] = row;
    if (
      row.length !== 2 ||
      !Number.isFinite(time) ||
      !Number.isFinite(zoom) ||
      time < 0 ||
      time > 600 ||
      zoom < 1 ||
      zoom > 1.5 ||
      (i > 0 && time <= data[i - 1][0])
    )
      throw Error("Зум: время должно возрастать, масштаб — от 1 до 1,5");
    return { time, zoom };
  });
}
export function editedDuration(text: string, duration: number) {
  const segments = parseSegments(text, duration);
  return segments.length
    ? segments.reduce((sum, s) => sum + s.end - s.start, 0)
    : duration;
}
export function originalTime(text: string, time: number) {
  const segments = parseSegments(text);
  if (!segments.length) return time;
  let remaining = time;
  for (const s of segments) {
    if (remaining < s.end - s.start) return s.start + remaining;
    remaining -= s.end - s.start;
  }
  return segments[segments.length - 1].end;
}
export function zoomExpression(text: string, fps: number) {
  const points = parseZoom(text);
  if (!points.length) return "1";
  let expression = String(points.at(-1)!.zoom);
  for (let i = points.length - 2; i >= 0; i--) {
    const a = points[i],
      b = points[i + 1];
    const progress = `((on/${fps}-${a.time})/${b.time - a.time})`;
    // Smoothstep: zero velocity at each keyframe.
    const value = `${a.zoom}+(${b.zoom - a.zoom})*${progress}*${progress}*(3-2*${progress})`;
    expression = `if(lt(on/${fps},${b.time}),${value},${expression})`;
  }
  return `if(lt(on/${fps},${points[0].time}),${points[0].zoom},${expression})`;
}
export function montageGraph(text: string, audio: boolean) {
  const segments = parseSegments(text);
  if (!segments.length) return { graph: "", video: "0:v", audio: "0:a" };
  const n = segments.length;
  let graph = `[0:v]split=${n}${segments.map((_, i) => `[sv${i}]`).join("")};`;
  if (audio)
    graph += `[0:a]asplit=${n}${segments.map((_, i) => `[sa${i}]`).join("")};`;
  segments.forEach((s, i) => {
    graph += `[sv${i}]trim=start=${s.start}:end=${s.end},setpts=PTS-STARTPTS[v${i}];`;
    if (audio)
      graph += `[sa${i}]atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS,apad,atrim=duration=${s.end - s.start}[a${i}];`;
  });
  graph +=
    segments.map((_, i) => `[v${i}]${audio ? `[a${i}]` : ""}`).join("") +
    `concat=n=${n}:v=1:a=${audio ? 1 : 0}[editedv]${audio ? "[editeda]" : ""};`;
  return { graph, video: "editedv", audio: "editeda" };
}
