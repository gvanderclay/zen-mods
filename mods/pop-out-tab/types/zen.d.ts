/** Narrow hand-authored types for the privileged Firefox/Zen APIs this mod uses. */

interface XulElement extends Element {}

interface Document {
  createXULElement(tagName: string): XulElement;
}

interface TabBrowserShape {
  readonly selectedTab: unknown | null;
  replaceTabWithWindow(
    tab: unknown,
    options?: Record<string, string>,
    zenForceSync?: boolean,
  ): Window | null | undefined;
}

type PopOutTabState =
  import("@zen-mods/sine-lifecycle/sine-window").SineWindowGenerationState;
type PopOutTabShortcutManager = import("../src/platform/shortcut.ts").ShortcutManager;

interface Window {
  zenPopOutTab?: PopOutTabState;
  addUnloadListener?: (callback: () => void) => void;
}

interface ServicesShape {
  readonly prefs: {
    getStringPref(name: string, fallback: string): string;
    setStringPref(name: string, value: string): void;
  };
}

declare const gBrowser: TabBrowserShape;
declare const gZenKeyboardShortcutsManager: PopOutTabShortcutManager;
declare const Services: ServicesShape;
