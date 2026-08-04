import { isDebug } from "./prefs.ts";

/** Writes to the Browser Console under a fixed prefix, when the debug pref is on. */
export const log = (...args: unknown[]) => {
  if (isDebug()) {
    console.log("[keep-loaded]", ...args);
  }
};
