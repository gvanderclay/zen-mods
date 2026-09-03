import { createFirefoxPaletteFilePort } from "./platform/file.ts";
import { startPaletteBridgeGeneration } from "./platform/sine.ts";
import { createZenPaletteStyleView } from "./platform/styles.ts";
import { isPaletteWindowEligible } from "./platform/window.ts";
import { PaletteBridgeController } from "./runtime.ts";

window.zenPaletteBridge?.controller.stop("replacement");

const generationToken = window.crypto.randomUUID();
const eligible = isPaletteWindowEligible(window.document.documentElement);
const controller = new PaletteBridgeController({
  eligible,
  ...(eligible
    ? {
        file: createFirefoxPaletteFilePort(),
        view: createZenPaletteStyleView(window.document, generationToken),
      }
    : {}),
  onError: error => console.error("[palette-bridge] update skipped", error),
  timers: {
    clearTimeout: handle => window.clearTimeout(handle),
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  },
});

startPaletteBridgeGeneration({
  controller,
  generationToken,
  onSineUnloadUnavailable: () =>
    console.error("[palette-bridge] Sine unload hook is unavailable"),
  target: window,
});

try {
  if (!controller.start()) {
    throw new Error("Palette Bridge generation did not start");
  }
  console.info(`[palette-bridge] ready (${eligible ? "active" : "native"})`);
} catch (error) {
  controller.stop("startup-failure");
  throw error;
}
