/**
 * Every pref this mod reads or writes. Privileged: touches `Services.prefs`.
 */

import type { Probe } from "../core/capabilities.ts";
import { DEFAULT_DEBUG, DEFAULT_MATCH } from "../core/defaults.ts";

export const PREF_MATCH = "zen.keep-loaded.match";
export const PREF_DEBUG = "zen.keep-loaded.debug";
export const PREF_ONDEMAND = "browser.sessionstore.restore_pinned_tabs_on_demand";

export const rawMatchList = () => Services.prefs.getStringPref(PREF_MATCH, DEFAULT_MATCH);

export const isDebug = () => Services.prefs.getBoolPref(PREF_DEBUG, DEFAULT_DEBUG);

export const isOnDemand = () => Services.prefs.getBoolPref(PREF_ONDEMAND, false);

/**
 * The only global pref this mod writes, and only for the duration of a wake.
 * Every caller restores it — see D002 and the teardown in `main.ts`.
 */
export const setOnDemand = (value: boolean) =>
  Services.prefs.setBoolPref(PREF_ONDEMAND, value);

/**
 * Calls back when the allowlist is edited, so the settings row applies without a
 * reload. Returns the disposer — Sine re-imports this module on every mod toggle,
 * and an observer left behind would fire twice for one edit (D006).
 */
export const observeMatchList = (onChange: () => void) => {
  const observer: PrefObserver = { observe: () => onChange() };
  Services.prefs.addObserver(PREF_MATCH, observer);
  return () => Services.prefs.removeObserver(PREF_MATCH, observer);
};

/**
 * Required: the whole wake mechanism is a flip of this pref around
 * `_insertBrowser` (D002). If Firefox ever drops it, `setBoolPref` would happily
 * create a pref nothing reads and the wake would fail silently.
 */
export const prefProbes = (): Probe[] => [
  {
    name: PREF_ONDEMAND,
    present: Services.prefs.getPrefType(PREF_ONDEMAND) === Services.prefs.PREF_BOOL,
    required: true,
  },
];
