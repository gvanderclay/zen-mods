/**
 * Every pref this mod reads or writes. Privileged: touches `Services.prefs`.
 */

import type { Probe } from "../core/capabilities.ts";
import {
  DEFAULT_CRASH_ATTEMPTS,
  DEFAULT_CRASH_WINDOW,
  DEFAULT_DEBUG,
  DEFAULT_FRESHEN_HOLD_SECONDS,
  DEFAULT_FRESHEN_SECONDS,
  DEFAULT_LAZY_PINNED,
  DEFAULT_MATCH,
  DEFAULT_SHOW_STATUS_BUTTON,
} from "../core/defaults.ts";
import { type PulseSettings, parsePulseSettings } from "../core/freshness.ts";
import { parseMatchList } from "../core/match.ts";
import { parseAttempts, parseWindowMs } from "../core/recovery.ts";

export const PREF_MATCH = "zen.keep-loaded.match";
export const PREF_DEBUG = "zen.keep-loaded.debug";
export const PREF_LAZY_PINNED = "zen.keep-loaded.lazy-pinned";
export const PREF_CRASH_ATTEMPTS = "zen.keep-loaded.crash-attempts";
export const PREF_CRASH_WINDOW = "zen.keep-loaded.crash-window-minutes";
export const PREF_FRESHEN = "zen.keep-loaded.freshen-seconds";
export const PREF_FRESHEN_HOLD = "zen.keep-loaded.freshen-hold-seconds";
export const PREF_ONDEMAND = "browser.sessionstore.restore_pinned_tabs_on_demand";
export const PREF_SHOW_STATUS_BUTTON = "zen.keep-loaded.show-status-button";

export const rawMatchList = () => Services.prefs.getStringPref(PREF_MATCH, DEFAULT_MATCH);

/** Unparsed: `parseAttempts` owns what a text field can contain. */
export const rawCrashAttempts = () =>
  Services.prefs.getStringPref(PREF_CRASH_ATTEMPTS, DEFAULT_CRASH_ATTEMPTS);

/** Minutes, unparsed: `parseWindowMs` owns what a text field can contain. */
export const rawCrashWindow = () =>
  Services.prefs.getStringPref(PREF_CRASH_WINDOW, DEFAULT_CRASH_WINDOW);

/** Seconds, unparsed: `parsePulseSettings` owns what a text field can contain. */
export const rawFreshenSeconds = () =>
  Services.prefs.getStringPref(PREF_FRESHEN, DEFAULT_FRESHEN_SECONDS);

/** Seconds, same contract. */
export const rawFreshenHoldSeconds = () =>
  Services.prefs.getStringPref(PREF_FRESHEN_HOLD, DEFAULT_FRESHEN_HOLD_SECONDS);

export const isDebug = () => Services.prefs.getBoolPref(PREF_DEBUG, DEFAULT_DEBUG);

/** This mod's own setting. `PREF_ONDEMAND` is the global pref it drives (D012). */
export const isLazyPinnedWanted = () =>
  Services.prefs.getBoolPref(PREF_LAZY_PINNED, DEFAULT_LAZY_PINNED);

export const isStatusButtonWanted = () =>
  Services.prefs.getBoolPref(PREF_SHOW_STATUS_BUTTON, DEFAULT_SHOW_STATUS_BUTTON);

/**
 * Calls back when a settings row is edited, so it applies without a reload.
 * Returns the disposer — Sine re-imports this module on every mod toggle, and an
 * observer left behind would fire twice for one edit (D006).
 */
export const observePref = (name: string, onChange: () => void) => {
  const observer: XpcomObserver = { observe: () => onChange() };
  Services.prefs.addObserver(name, observer);
  return () => Services.prefs.removeObserver(name, observer);
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

export type ObservedPreference =
  | "match"
  | "lazy-pinned"
  | "freshen"
  | "freshen-hold"
  | "crash-attempts"
  | "crash-window"
  | "debug"
  | "status-button";

export interface PreferencesSnapshot {
  readonly match: readonly string[];
  readonly crashAttempts: number;
  readonly crashWindowMs: number;
  readonly freshen: Readonly<PulseSettings>;
  readonly debug: boolean;
  readonly lazyPinnedWanted: boolean;
  readonly showStatusButton: boolean;
}

/** The uncached platform source used to construct the semantic preference port. */
export interface RawPreferencesPort {
  readMatch(): string;
  readCrashAttempts(): string;
  readCrashWindow(): string;
  readFreshenSeconds(): string;
  readFreshenHoldSeconds(): string;
  readDebug(): boolean;
  readLazyPinnedWanted(): boolean;
  readShowStatusButton(): boolean;
  observe(which: ObservedPreference, onChange: () => void): () => void;
  probes(): readonly Probe[];
}

/** Semantic settings boundary consumed by the controller runtime. */
export interface PreferencesPort {
  snapshot(): PreferencesSnapshot;
  observe(which: ObservedPreference, onChange: () => void): () => void;
  probes(): readonly Probe[];
}

interface RawValues {
  match: string;
  crashAttempts: string;
  crashWindow: string;
  freshen: string;
  freshenHold: string;
  debug: boolean;
  lazyPinnedWanted: boolean;
  showStatusButton: boolean;
}

const snapshotFor = (raw: RawValues): PreferencesSnapshot =>
  Object.freeze({
    match: Object.freeze(parseMatchList(raw.match)),
    crashAttempts: parseAttempts(raw.crashAttempts),
    crashWindowMs: parseWindowMs(raw.crashWindow),
    freshen: Object.freeze(parsePulseSettings(raw.freshen, raw.freshenHold)),
    debug: raw.debug,
    lazyPinnedWanted: raw.lazyPinnedWanted,
    showStatusButton: raw.showStatusButton,
  });

/**
 * Keeps parsed, stable settings in one observer-maintained immutable snapshot.
 * Browser/tab/selection facts deliberately remain outside this cache.
 */
export const createCachedPreferences = (source: RawPreferencesPort): PreferencesPort => {
  let raw: RawValues | null = null;
  let current: PreferencesSnapshot | null = null;
  let cachedProbes: readonly Probe[] | null = null;

  const ensure = () => {
    if (!raw || !current) {
      raw = {
        match: source.readMatch(),
        crashAttempts: source.readCrashAttempts(),
        crashWindow: source.readCrashWindow(),
        freshen: source.readFreshenSeconds(),
        freshenHold: source.readFreshenHoldSeconds(),
        debug: source.readDebug(),
        lazyPinnedWanted: source.readLazyPinnedWanted(),
        showStatusButton: source.readShowStatusButton(),
      };
      current = snapshotFor(raw);
    }
    return { raw, snapshot: current } as const;
  };

  const refresh = (which: ObservedPreference) => {
    if (!raw || !current) {
      ensure();
      return;
    }
    switch (which) {
      case "match": {
        const value = source.readMatch();
        raw = { ...raw, match: value };
        current = Object.freeze({
          ...current,
          match: Object.freeze(parseMatchList(value)),
        });
        break;
      }
      case "crash-attempts": {
        const value = source.readCrashAttempts();
        raw = { ...raw, crashAttempts: value };
        current = Object.freeze({ ...current, crashAttempts: parseAttempts(value) });
        break;
      }
      case "crash-window": {
        const value = source.readCrashWindow();
        raw = { ...raw, crashWindow: value };
        current = Object.freeze({ ...current, crashWindowMs: parseWindowMs(value) });
        break;
      }
      case "freshen": {
        const value = source.readFreshenSeconds();
        raw = { ...raw, freshen: value };
        current = Object.freeze({
          ...current,
          freshen: Object.freeze(parsePulseSettings(value, raw.freshenHold)),
        });
        break;
      }
      case "freshen-hold": {
        const value = source.readFreshenHoldSeconds();
        raw = { ...raw, freshenHold: value };
        current = Object.freeze({
          ...current,
          freshen: Object.freeze(parsePulseSettings(raw.freshen, value)),
        });
        break;
      }
      case "debug": {
        const value = source.readDebug();
        raw = { ...raw, debug: value };
        current = Object.freeze({ ...current, debug: value });
        break;
      }
      case "lazy-pinned": {
        const value = source.readLazyPinnedWanted();
        raw = { ...raw, lazyPinnedWanted: value };
        current = Object.freeze({ ...current, lazyPinnedWanted: value });
        break;
      }
      case "status-button": {
        const value = source.readShowStatusButton();
        raw = { ...raw, showStatusButton: value };
        current = Object.freeze({ ...current, showStatusButton: value });
        break;
      }
    }
  };

  return {
    snapshot: () => ensure().snapshot,
    observe: (which, onChange) =>
      source.observe(which, () => {
        refresh(which);
        onChange();
      }),
    probes: () => {
      if (!cachedProbes) {
        cachedProbes = Object.freeze(
          source.probes().map(probe => Object.freeze({ ...probe })),
        );
      }
      return cachedProbes;
    },
  };
};

const observedNames: Record<ObservedPreference, string> = {
  match: PREF_MATCH,
  "lazy-pinned": PREF_LAZY_PINNED,
  freshen: PREF_FRESHEN,
  "freshen-hold": PREF_FRESHEN_HOLD,
  "crash-attempts": PREF_CRASH_ATTEMPTS,
  "crash-window": PREF_CRASH_WINDOW,
  debug: PREF_DEBUG,
  "status-button": PREF_SHOW_STATUS_BUTTON,
};

export const preferences = createCachedPreferences({
  readMatch: rawMatchList,
  readCrashAttempts: rawCrashAttempts,
  readCrashWindow: rawCrashWindow,
  readFreshenSeconds: rawFreshenSeconds,
  readFreshenHoldSeconds: rawFreshenHoldSeconds,
  readDebug: isDebug,
  readLazyPinnedWanted: isLazyPinnedWanted,
  readShowStatusButton: isStatusButtonWanted,
  observe: (which, onChange) => observePref(observedNames[which], onChange),
  probes: prefProbes,
});
