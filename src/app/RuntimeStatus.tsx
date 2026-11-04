"use client";
import { useEffect, useState } from "react";
import type { DesktopStatus } from "@/lib/desktop-engine";
export default function RuntimeStatus() {
  const [status, setStatus] = useState<DesktopStatus | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const bridge = window.videoUniqueDesktop;
    if (!bridge) return;
    void bridge
      .getStatus()
      .then(async (value) => {
        setStatus(value);
        if (value.selfTest && process.env.NEXT_PUBLIC_DESKTOP === "1") {
          const { desktopSelfTest } = await import("@/lib/desktop-self-test");
          await desktopSelfTest(bridge);
        }
      })
      .catch((e) => setError(String(e)));
  }, []);
  if (!status) return <span className="privacy">● Локальная обработка</span>;
  return (
    <div className="desktop-runtime">
      <span className="privacy" title={status.tools?.version}>
        ● Windows · FFmpeg
      </span>
      <button
        className="btn small ghost"
        onClick={() =>
          void window.videoUniqueDesktop
            ?.openResults()
            .catch((e) => setError(String(e)))
        }
      >
        Папка результатов
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
