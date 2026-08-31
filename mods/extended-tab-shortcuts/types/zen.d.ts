/** Narrow hand-authored types for the privileged Firefox/Zen APIs this mod uses. */

interface XulElement extends Element {}

interface Document {
  createXULElement(tagName: string): XulElement;
}

interface TabBrowserShape {
  readonly selectedTab: unknown | null;
}

type ExtendedTabShortcutsState =
  import("@zen-mods/sine-lifecycle/sine-window").SineWindowGenerationState;
type ExtendedTabShortcutsManager = import("../src/platform/shortcut.ts").ShortcutManager;

interface Window {
  zenExtendedTabShortcuts?: ExtendedTabShortcutsState;
  addUnloadListener?: (callback: () => void) => void;
}

interface ServicesShape {
  readonly prefs: {
    getStringPref(name: string, fallback: string): string;
    setStringPref(name: string, value: string): void;
  };
  readonly scriptSecurityManager: {
    getSystemPrincipal(): unknown;
  };
}

interface ZenWorkspacesShape {
  readonly activeWorkspace: string;
  readonly activeWorkspaceElement?: {
    readonly collapsiblePins?: { readonly activeTabs?: readonly unknown[] };
    readonly hasCollapsedPinnedTabs: boolean;
  };
}

declare const gBrowser: TabBrowserShape;
declare const gZenKeyboardShortcutsManager: ExtendedTabShortcutsManager;
declare const gZenWorkspaces: ZenWorkspacesShape;
declare const Services: ServicesShape;
declare const PrivateBrowsingUtils: {
  isWindowPrivate(target: Window): boolean;
};
