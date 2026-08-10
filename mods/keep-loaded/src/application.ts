// Stable process-scoped entry. Sine imports this declared .sys.mjs once, before the
// cache-busted per-window bundle; browser windows reach it through ChromeUtils.

import {
  APPLICATION_COORDINATOR_PROTOCOL,
  KeepLoadedApplicationOwner,
  type WindowWorkDelegate,
} from "./application-coordinator.ts";
import type { CrashFacts } from "./core/crash.ts";

const PREF_ONDEMAND = "browser.sessionstore.restore_pinned_tabs_on_demand";
const Timer = ChromeUtils.importESModule<{
  clearTimeout(handle: unknown): void;
  setTimeout(callback: () => void, delayMs: number): unknown;
}>("resource://gre/modules/Timer.sys.mjs");

const owner = new KeepLoadedApplicationOwner<BrowserTab, CrashFacts>({
  applicationId: Services.uuid.generateUUID().toString(),
  preferences: {
    readOnDemand: () => Services.prefs.getBoolPref(PREF_ONDEMAND, false),
    writeOnDemand: value => Services.prefs.setBoolPref(PREF_ONDEMAND, value),
  },
  reportError: error => {
    console.error("[keep-loaded] application owner failed", error);
  },
  timers: {
    clearTimeout: Timer.clearTimeout,
    now: Date.now,
    setTimeout: Timer.setTimeout,
  },
});

export const protocol = APPLICATION_COORDINATOR_PROTOCOL;
export const applicationId = owner.snapshot().applicationId;
export const register = (delegate: WindowWorkDelegate<BrowserTab, CrashFacts>) =>
  owner.register(delegate);
export const snapshot = () => owner.snapshot();
