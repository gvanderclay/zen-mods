/**
 * What to do when something unloaded a kept tab.
 *
 * `undiscardable` does not protect a tab from being unloaded on purpose: it is read in
 * exactly one place in the tree, `TabUnloader.sys.mjs` 54, which is the memory-pressure
 * path. `_mayDiscardBrowser` checks selected, closing, dialogs and `permitUnload`, and
 * never looks at it, so Zen's "unload space" and "unload all other spaces" both reach a
 * kept tab through `discardBrowser(tab, true)` — see D005.
 *
 * The answer is to notice and wake it again rather than to stop the unload. Both Zen
 * commands compute their tab lists inside the method from private state, so a wrapper
 * cannot filter what they unload; the only shared seam, `gBrowser.explicitUnloadTabs`,
 * is also what the tab context menu's targeted "Unload Tab" calls, and refusing that
 * one would override a deliberate action. Waking after the fact needs no patching and
 * covers every unloader, including ones this mod has never heard of.
 */

export interface UnloadFacts {
  url: string;
  /** Whether the mod keeps this tab. A merely-pinned tab being unloaded is not ours. */
  kept: boolean;
  /** Whether application work already holds the lock; the request may still be queued. */
  busy: boolean;
}

export type UnloadPlan =
  | { action: "ignore"; reason: string }
  | { action: "wake"; message: string };

export function unloadPlan(facts: UnloadFacts): UnloadPlan {
  const { url, kept, busy } = facts;

  if (!kept) {
    return { action: "ignore", reason: "not a tab the mod keeps" };
  }
  return {
    action: "wake",
    message: busy
      ? `${url} was unloaded — queuing a reconciliation`
      : `${url} was unloaded — waking it again`,
  };
}
