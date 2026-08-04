/**
 * Working out what a tab's url actually is. Pure — takes strings, never tabs.
 *
 * A live browser normally answers this itself, but not always. After a background
 * crash, `SessionStore.reviveCrashedTab` parks the browser at `about:blank` on
 * purpose (`SessionStore.sys.mjs` 5484), so the tab reports a url that matches no
 * allowlist and the mod would quietly stop keeping it — see D017.
 */

const PLACEHOLDERS = new Set(["", "about:blank"]);

/** True when the url tells us nothing about what the tab is really showing. */
export function isPlaceholderUrl(url: string): boolean {
  return PLACEHOLDERS.has(url);
}

/**
 * The live url, or the session's if the live one is a placeholder.
 *
 * `stored` is a thunk because reading it means serialising the whole tab state,
 * which is not worth doing for the overwhelming majority of tabs that answer for
 * themselves. It is also allowed to throw: `getTabState` does, for a tab whose
 * window SessionStore is not tracking.
 */
export function resolveUrl(live: string, stored: () => string): string {
  if (!isPlaceholderUrl(live)) {
    return live;
  }
  let fallback = "";
  try {
    fallback = stored();
  } catch {
    return live;
  }
  return isPlaceholderUrl(fallback) ? live : fallback;
}

interface TabStateShape {
  index?: unknown;
  entries?: unknown;
}

/**
 * Pulls the active entry's url out of `SessionStore.getTabState` output.
 *
 * The index is 1-based and clamped the same way `restoreTab` clamps it
 * (`SessionStore.sys.mjs` 6588-6592), so state saved with a stale index resolves
 * to a real entry rather than to nothing.
 */
export function urlFromTabState(json: string): string {
  let state: TabStateShape | null = null;
  try {
    state = JSON.parse(json) as TabStateShape | null;
  } catch {
    return "";
  }
  const entries = state?.entries;
  if (!Array.isArray(entries) || !entries.length) {
    return "";
  }
  const requested = typeof state?.index === "number" ? state.index : entries.length;
  const index = Math.min(Math.max(requested - 1, 0), entries.length - 1);
  const url = (entries[index] as { url?: unknown } | undefined)?.url;
  return typeof url === "string" ? url : "";
}
