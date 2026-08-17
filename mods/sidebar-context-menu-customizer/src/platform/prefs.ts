import { decodeStoredIds, encodeStoredIds } from "../core/policy.ts";

export const PREF_EXCLUDED_ROOT_TAB_ITEMS =
  "zen.sidebar-context-menu-customizer.tab.excluded-root-items";
export const PREF_LEGACY_HIDDEN_TAB_ITEMS =
  "zen.sidebar-context-menu-customizer.tab.hidden-items";
export const PREF_TAB_ITEMS_INITIALIZED =
  "zen.sidebar-context-menu-customizer.tab.opt-in-initialized";

export const readExcludedRootTabItems = (): Set<string> | null => {
  try {
    if (!Services.prefs.prefHasUserValue(PREF_TAB_ITEMS_INITIALIZED)) {
      return null;
    }
    const pref = Services.prefs.prefHasUserValue(PREF_EXCLUDED_ROOT_TAB_ITEMS)
      ? PREF_EXCLUDED_ROOT_TAB_ITEMS
      : PREF_LEGACY_HIDDEN_TAB_ITEMS;
    return decodeStoredIds(Services.prefs.getStringPref(pref, "[]"));
  } catch (error) {
    console.error("[sidebar-context-menu-customizer] could not read preferences", error);
    return new Set();
  }
};

export const writeExcludedRootTabItems = (ids: ReadonlySet<string>) => {
  try {
    Services.prefs.setStringPref(PREF_EXCLUDED_ROOT_TAB_ITEMS, encodeStoredIds(ids));
    Services.prefs.setBoolPref(PREF_TAB_ITEMS_INITIALIZED, true);
  } catch (error) {
    console.error("[sidebar-context-menu-customizer] could not save preferences", error);
  }
};
