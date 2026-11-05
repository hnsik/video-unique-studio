import { selectAutoSettings } from "../lib/auto-analysis";
self.onmessage = (event) => {
  try {
    self.postMessage({
      result: selectAutoSettings(event.data.settings, event.data.rgb),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
