/** Narrow hand-authored types for the privileged Firefox/Zen APIs this mod uses. */

type DuplicateTabToastState =
  import("@zen-mods/sine-lifecycle/sine-window").SineWindowGenerationState;
type DuplicateTabToastManager = import("../src/platform/toast.ts").ToastManager;

interface Window {
  zenDuplicateTabToast?: DuplicateTabToastState;
  addUnloadListener?: (callback: () => void) => void;
}

interface TabBrowserShape {
  readonly tabContainer: Element;
}

declare const gBrowser: TabBrowserShape;
declare const gZenUIManager: DuplicateTabToastManager;
