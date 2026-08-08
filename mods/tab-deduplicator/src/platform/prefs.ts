import { DEFAULT_INCLUDE_PINNED, PREF_INCLUDE_PINNED } from "../core/defaults.ts";

type BoolPrefReader = (name: string, fallback: boolean) => unknown;

export const readIncludePinnedPreference = (
  read: BoolPrefReader = (name, fallback) => Services.prefs.getBoolPref(name, fallback),
) => {
  try {
    const value = read(PREF_INCLUDE_PINNED, DEFAULT_INCLUDE_PINNED);
    return typeof value === "boolean" ? value : DEFAULT_INCLUDE_PINNED;
  } catch (error) {
    console.error("[tab-deduplicator] could not read pinned-tab preference", error);
    return DEFAULT_INCLUDE_PINNED;
  }
};
