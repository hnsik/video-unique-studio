"use strict";
const api = window.videoUniqueDesktop;
function show(state) {
  document.getElementById("message").textContent =
    state.message || "Подготовка…";
  document.getElementById("fill").style.width =
    (state.percent || (state.phase === "ready" && 100) || 0) + "%";
  document.getElementById("details").textContent = state.total
    ? `${(state.received / 1048576).toFixed(1)} / ${(state.total / 1048576).toFixed(1)} МБ`
    : state.phase === "checking"
      ? "Ищем установленные компоненты…"
      : "";
  document.getElementById("error").textContent = state.error || "";
  for (const id of ["retry", "choose"])
    document.getElementById(id).hidden = state.phase !== "error";
}
api.onStatus(show);
api.getStatus().then(show);
document.getElementById("retry").onclick = () =>
  api
    .retryTools()
    .catch((error) =>
      show({
        phase: "error",
        message: "Не удалось подготовить компоненты",
        error: error.message,
      }),
    );
document.getElementById("choose").onclick = () =>
  api
    .chooseTools()
    .catch((error) =>
      show({
        phase: "error",
        message: "Не удалось подключить FFmpeg",
        error: error.message,
      }),
    );
