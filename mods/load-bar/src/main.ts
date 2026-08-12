import { bindSineWindowLifecycle } from "@zen-mods/sine-lifecycle/sine-window";
import { DEFAULT_SETTINGS } from "./core/settings.ts";
import { installNativeIndicatorHandoff } from "./platform/native-indicator.ts";
import { createBrowserProgressSource } from "./platform/progress.ts";
import { createPaneActivityView } from "./platform/view.ts";
import { LoadBarController } from "./runtime.ts";

window.zenLoadBar?.controller.stop("replacement");

const generationToken = window.crypto.randomUUID();
let controller!: LoadBarController<LoadBarBrowser>;
const progress = createBrowserProgressSource<LoadBarBrowser>({
  flags: {
    network: Ci.nsIWebProgressListener.STATE_IS_NETWORK,
    restoring: Ci.nsIWebProgressListener.STATE_RESTORING,
    start: Ci.nsIWebProgressListener.STATE_START,
    stop: Ci.nsIWebProgressListener.STATE_STOP,
  },
  isCanceledStatus: status => status === Cr.NS_BINDING_ABORTED,
  isLive: () => controller.isLive(),
  isSuccessStatus: status => Components.isSuccessCode(status),
  tabs: gBrowser,
});

controller = new LoadBarController({
  createView: browser =>
    createPaneActivityView({
      browser,
      document: window.document,
      generationToken,
      getComputedStyle: element => window.getComputedStyle(element),
      settings: DEFAULT_SETTINGS,
      tabs: gBrowser,
    }),
  onError: error => console.error("[load-bar] generation failed", error),
  progress,
  revealDelayMs: DEFAULT_SETTINGS.revealDelayMs,
  terminalDelayMs: {
    success: 220,
    canceled: 160,
    "network-error": 160,
  },
  timers: {
    clearTimeout: handle => window.clearTimeout(handle),
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  },
});

const facade: LoadBarState = Object.freeze({ controller, generationToken });
window.zenLoadBar = facade;
controller.defer(() => {
  if (window.zenLoadBar === facade) {
    delete window.zenLoadBar;
  }
});

try {
  const binding = bindSineWindowLifecycle(window, controller);
  if (binding.sineUnload === "unavailable") {
    console.error("[load-bar] Sine unload hook is unavailable");
  }
  controller.start();
  installNativeIndicatorHandoff({
    defer: disposer => controller.defer(disposer),
    document: window.document,
    token: generationToken,
  });
  console.info("[load-bar] ready");
} catch (error) {
  controller.stop("startup-failure");
  throw error;
}
