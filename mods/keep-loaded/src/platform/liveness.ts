/**
 * Watches for signs that a pinned tab is still alive, and records them. Acts on
 * nothing — see D016.
 *
 * Crash-attempt history is deliberately not kept here. The browser-window module is
 * cache-busted on every Sine reload, while the rolling recovery budget belongs to the
 * stable application owner. Keeping that state beside event delivery would reset the
 * budget on reload and would make a stale window generation able to spend it.
 */

import type { CrashKind } from "../core/crash.ts";
import { isLifeSign, type Sign, type SignKind } from "../core/liveness.ts";
import { parseMatchList } from "../core/match.ts";
import { shouldKeep } from "../core/policy.ts";
import { factsFor, loadStateOf } from "./browser.ts";
import { log } from "./log.ts";
import { rawMatchList } from "./prefs.ts";

const signs = new WeakMap<BrowserTab, Sign>();

export const signFor = (tab: BrowserTab): Sign | null => signs.get(tab) ?? null;

export const recordSign = (tab: BrowserTab, kind: SignKind) => {
  const previous = signs.get(tab);
  signs.set(tab, { kind, at: Date.now() });
  // Only when the kind changes, never for the first sighting, and only for a tab
  // the mod actually keeps: a live tab relabels constantly, the sweep summary
  // already lists what it seeded, and a line about a merely-pinned tab reads as if
  // a kept one had died. What is left is one line per transition, which is the only
  // way to watch the ledger without a Browser Console that can evaluate — see D016.
  if (previous && previous.kind !== kind) {
    const facts = factsFor(tab);
    if (shouldKeep(facts, parseMatchList(rawMatchList()))) {
      log(`${facts.url}: ${previous.kind} -> ${kind}`);
    }
  }
};

/** Events that name a tab directly, mapped to what seeing them tells us. */
const TAB_EVENTS: Record<string, SignKind> = {
  // Dispatched with detail.changed naming the attributes (tabbrowser.js 2246). Only
  // a label change is a sign of life: the page rewrote its own title, so its JS ran.
  TabAttrModified: "label",
  TabBrowserDiscarded: "discarded",
};

/**
 * Events dispatched on the browser, so the tab has to be looked up. The two are
 * different failures, not two names for one: a mismatch is unretryable (D017).
 */
const BROWSER_EVENTS: Record<string, CrashKind> = {
  "oop-browser-crashed": "crashed",
  "oop-browser-buildid-mismatch": "restart-required",
};

/**
 * Called for a pinned tab whose content process died. Deciding what to do about it
 * belongs to whoever owns the sweep, not here.
 */
export type CrashHandler = (tab: BrowserTab, kind: CrashKind) => void;

/**
 * Called for a pinned tab something unloaded — Zen's own space commands reach a kept
 * tab, because `undiscardable` does not stop a deliberate unload (D005).
 */
export type DiscardHandler = (tab: BrowserTab) => void;

/** A closed or newly unpinned tab cannot retain an application recovery key. */
export type RecoveryInvalidationHandler = (tab: BrowserTab) => void;

/** Selection makes the docshell user-owned; a pulse claim must be forgotten. */
export type TabSelectionHandler = (tab: BrowserTab) => void;

/**
 * Listens on the document rather than `gBrowser.tabContainer`: Zen keeps each
 * space's tabs in its own container, and all of these events bubble, so the
 * document is the one node that sees every space (the same reason the sweep uses
 * `allStoredTabs`). The generation predicate is checked at delivery and again before
 * mutations and callbacks, so a queued event cannot revive an unloaded instance.
 */
export const observeSigns = (
  isLive: () => boolean,
  onCrash?: CrashHandler,
  onDiscard?: DiscardHandler,
  onRecoveryInvalidated?: RecoveryInvalidationHandler,
  onTabSelected?: TabSelectionHandler,
): (() => void) => {
  const document = window.document;

  const onTabEvent = (event: Event) => {
    if (!isLive()) {
      return;
    }
    const kind = TAB_EVENTS[event.type];
    const tab = event.target as unknown as BrowserTab | null;
    // Pinned only. Ordinary tabs change their labels constantly and the mod has no
    // interest in them.
    if (!kind || !tab?.pinned) {
      return;
    }
    if (kind === "label" && !labelChanged(event)) {
      return;
    }
    if (!isLifeSign(kind, loadStateOf(tab))) {
      return;
    }
    if (!isLive()) {
      return;
    }
    recordSign(tab, kind);
    if (kind === "discarded" && isLive()) {
      // The event is dispatched after `_createLazyBrowser`, so the tab is already a
      // lazy shell here — the same state a sweep wakes (`tabbrowser.js` 3261).
      onDiscard?.(tab);
    }
  };

  const onBrowserEvent = (event: Event) => {
    if (!isLive()) {
      return;
    }
    const kind = BROWSER_EVENTS[event.type];
    const browser = event.target as unknown as object | null;
    if (!kind || !browser) {
      return;
    }
    const tab = window.gBrowser.getTabForBrowser(browser);
    if (!tab?.pinned) {
      return;
    }
    if (!isLive()) {
      return;
    }
    recordSign(tab, kind);
    // Before returning to the event loop: tabbrowser's own handler is bound to the
    // <tabbrowser> element, which sits below the document in the bubble path, so by
    // the time we get here it has already revived the tab and parked it at
    // about:blank. Anything read later is later still.
    if (isLive()) {
      onCrash?.(tab, kind);
    }
  };

  const onRecoveryInvalidatedEvent = (event: Event) => {
    if (!isLive()) {
      return;
    }
    const tab = event.target as unknown as BrowserTab | null;
    if (tab && isLive()) {
      onRecoveryInvalidated?.(tab);
    }
  };

  const onTabSelectedEvent = (event: Event) => {
    if (!isLive()) {
      return;
    }
    const tab = event.target as unknown as BrowserTab | null;
    if (!tab?.pinned || !isLive()) {
      return;
    }
    onTabSelected?.(tab);
  };

  for (const type of Object.keys(TAB_EVENTS)) {
    document.addEventListener(type, onTabEvent);
  }
  for (const type of Object.keys(BROWSER_EVENTS)) {
    document.addEventListener(type, onBrowserEvent);
  }
  for (const type of ["TabClose", "TabUnpinned"]) {
    document.addEventListener(type, onRecoveryInvalidatedEvent);
  }
  document.addEventListener("TabSelect", onTabSelectedEvent);

  return () => {
    for (const type of Object.keys(TAB_EVENTS)) {
      document.removeEventListener(type, onTabEvent);
    }
    for (const type of Object.keys(BROWSER_EVENTS)) {
      document.removeEventListener(type, onBrowserEvent);
    }
    for (const type of ["TabClose", "TabUnpinned"]) {
      document.removeEventListener(type, onRecoveryInvalidatedEvent);
    }
    document.removeEventListener("TabSelect", onTabSelectedEvent);
  };
};

const labelChanged = (event: Event) => {
  const { detail } = event as CustomEvent<{ changed?: readonly string[] }>;
  return !!detail?.changed?.includes("label");
};
