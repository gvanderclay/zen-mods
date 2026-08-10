import { preferences } from "./prefs.ts";

/** Writes to the Browser Console under a fixed prefix, when the debug pref is on. */
export const log = (...args: unknown[]) => {
  if (preferences.snapshot().debug) {
    console.log("[keep-loaded]", ...args);
  }
};

/** Build sorted rows and other diagnostic-only detail only when it can be observed. */
export const logLazy = (detail: () => readonly unknown[] | null | undefined): void => {
  if (!preferences.snapshot().debug) {
    return;
  }
  const args = detail();
  if (args) {
    console.log("[keep-loaded]", ...args);
  }
};
