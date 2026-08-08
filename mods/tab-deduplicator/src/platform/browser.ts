/**
 * The native duplicate-tab action, kept behind the privileged platform boundary.
 *
 * Verified in Zen's shipped `browser/omni.ja`:
 *
 * - `tabbrowser.js` 5273–5338 groups by exact URI and `userContextId`, keeps the
 *   most recently active copy, skips pinned tabs, shows the first-use warning and
 *   removes the rest through the browser's normal close path.
 * - `tabbrowser.js` 529 delegates `gBrowser.tabs` to `tabs.js` `allTabs`; Zen's
 *   implementation at `tabs.js` 851–904 builds that list from the active workspace.
 * - `SessionStore.sys.mjs` 6693–6696 restores every essential as pinned, while
 *   `ZenPinnedTabManager.mjs` 506–545 pins a tab when it becomes essential.
 */

import type { DedupeMenuFacts } from "../core/menu.ts";

const supported = () =>
  typeof gBrowser.getAllDuplicateTabsToClose === "function" &&
  typeof gBrowser.removeAllDuplicateTabs === "function";

export const duplicateFacts = (): DedupeMenuFacts => ({
  supported: supported(),
  duplicateCount: supported() ? (gBrowser.getAllDuplicateTabsToClose?.().length ?? 0) : 0,
});

export const closeDuplicateTabs = () => {
  if (supported()) {
    gBrowser.removeAllDuplicateTabs?.();
  }
};
