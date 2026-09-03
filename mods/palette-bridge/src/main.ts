import { createFirefoxPaletteFilePort } from "./platform/file.ts";
import { observePalettePath } from "./platform/preferences.ts";
import { startPaletteBridgeGeneration } from "./platform/sine.ts";
import { createZenPaletteStyleView } from "./platform/styles.ts";
import { isPaletteWindowEligible } from "./platform/window.ts";
import { observeZenPaletteUpdates } from "./platform/zen-topics.ts";
import { PaletteBridgeController } from "./runtime.ts";

window.zenPaletteBridge?.controller.stop("replacement");

const generationToken = window.crypto.randomUUID();
const eligible = isPaletteWindowEligible(window.document.documentElement);
const controller = new PaletteBridgeController({
  eligible,
  enqueueMicrotask: callback => window.queueMicrotask(callback),
  ...(eligible
    ? {
        file: createFirefoxPaletteFilePort(),
        view: createZenPaletteStyleView(window.document, generationToken),
      }
    : {}),
  onError: error => console.error("[palette-bridge] update skipped", error),
  onPaletteApplied: palette =>
    console.info(
      `[palette-bridge] applied${palette.displayName ? `: ${palette.displayName}` : ""}`,
    ),
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
  if (eligible) {
    controller.defer(observePalettePath(Services.prefs, () => controller.pathChanged()));
    controller.defer(
      observeZenPaletteUpdates(Services.obs, () => controller.requestReapply()),
    );
  }
  if (!controller.start()) {
    throw new Error("Palette Bridge generation did not start");
  }
  console.info(`[palette-bridge] ready (${eligible ? "active" : "native"})`);
} catch (error) {
  controller.stop("startup-failure");
  throw error;
}
