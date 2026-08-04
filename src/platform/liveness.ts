/**
 * Watches for signs that a pinned tab is still alive, and records them. Acts on
 * nothing — see D016.
 *
 * The ledger is module-scoped, so a mod reload starts it empty. That is deliberate:
 * the sweep that follows a reload re-seeds every awake kept tab, and nothing yet
 * depends on history older than the current session.
 */

import type { Sign, SignKind } from "../core/liveness.ts";
import { parseMatchList } from "../core/match.ts";
import { shouldKeep } from "../core/policy.ts";
import { factsFor } from "./browser.ts";
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

/** Events dispatched on the browser, so the tab has to be looked up. */
const BROWSER_EVENTS: Record<string, SignKind> = {
  "oop-browser-crashed": "crashed",
  "oop-browser-buildid-mismatch": "crashed",
};

/**
 * Listens on the document rather than `gBrowser.tabContainer`: Zen keeps each
 * space's tabs in its own container, and all of these events bubble, so the
 * document is the one node that sees every space (the same reason the sweep uses
 * `allStoredTabs`).
 */
export const observeSigns = (): (() => void) => {
  const document = window.document;

  const onTabEvent = (event: Event) => {
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
    recordSign(tab, kind);
  };

  const onBrowserEvent = (event: Event) => {
    const kind = BROWSER_EVENTS[event.type];
    const browser = event.target as unknown as object | null;
    if (!kind || !browser) {
      return;
    }
    const tab = window.gBrowser.getTabForBrowser(browser);
    if (!tab?.pinned) {
      return;
    }
    recordSign(tab, kind);
  };

  for (const type of Object.keys(TAB_EVENTS)) {
    document.addEventListener(type, onTabEvent);
  }
  for (const type of Object.keys(BROWSER_EVENTS)) {
    document.addEventListener(type, onBrowserEvent);
  }

  return () => {
    for (const type of Object.keys(TAB_EVENTS)) {
      document.removeEventListener(type, onTabEvent);
    }
    for (const type of Object.keys(BROWSER_EVENTS)) {
      document.removeEventListener(type, onBrowserEvent);
    }
  };
};

const labelChanged = (event: Event) => {
  const { detail } = event as CustomEvent<{ changed?: readonly string[] }>;
  return !!detail?.changed?.includes("label");
};
