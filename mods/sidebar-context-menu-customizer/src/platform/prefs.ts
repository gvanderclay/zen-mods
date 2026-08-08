import { decodeHiddenIds, encodeHiddenIds } from "../core/policy.ts";

export const PREF_HIDDEN_TAB_ITEMS =
  "zen.sidebar-context-menu-customizer.tab.hidden-items";
export const PREF_TAB_ITEMS_INITIALIZED =
  "zen.sidebar-context-menu-customizer.tab.opt-in-initialized";
export const PREF_PROMOTED_TAB_ITEMS =
  "zen.sidebar-context-menu-customizer.tab.promoted-items";

export const readHiddenTabItems = (): Set<string> | null => {
  try {
    if (!Services.prefs.prefHasUserValue(PREF_TAB_ITEMS_INITIALIZED)) {
      return null;
    }
    return decodeHiddenIds(Services.prefs.getStringPref(PREF_HIDDEN_TAB_ITEMS, "[]"));
  } catch (error) {
    console.error("[sidebar-context-menu-customizer] could not read preferences", error);
    return new Set();
  }
};

export const writeHiddenTabItems = (ids: ReadonlySet<string>) => {
  try {
    Services.prefs.setStringPref(PREF_HIDDEN_TAB_ITEMS, encodeHiddenIds(ids));
    Services.prefs.setBoolPref(PREF_TAB_ITEMS_INITIALIZED, true);
  } catch (error) {
    console.error("[sidebar-context-menu-customizer] could not save preferences", error);
  }
};

export const readPromotedTabItems = (): Set<string> => {
  try {
    return decodeHiddenIds(Services.prefs.getStringPref(PREF_PROMOTED_TAB_ITEMS, "[]"));
  } catch (error) {
    console.error(
      "[sidebar-context-menu-customizer] could not read promoted actions",
      error,
    );
    return new Set();
  }
};

export const writePromotedTabItems = (ids: ReadonlySet<string>) => {
  try {
    Services.prefs.setStringPref(PREF_PROMOTED_TAB_ITEMS, encodeHiddenIds(ids));
  } catch (error) {
    console.error(
      "[sidebar-context-menu-customizer] could not save promoted actions",
      error,
    );
  }
};
