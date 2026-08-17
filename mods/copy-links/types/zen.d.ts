/** Narrow hand-authored types for the privileged Firefox/Zen APIs this mod uses. */

interface XulElement extends Element {}

interface Document {
  createXULElement(tagName: string): XulElement;
  l10n: {
    setAttributes(
      element: Element,
      id: string,
      args?: Record<string, string | number | boolean>,
    ): void;
  };
}

interface SharingUtilsShape {
  getLinksToShare(node: Element): Array<{ url: string; title: string }>;
}

interface ChromeUtilsShape {
  importESModule(specifier: string): { SharingUtils: SharingUtilsShape };
}

interface ClipboardHelperShape {
  copyString(text: string): void;
}

interface ClipboardHelperClass {
  getService(interfaceId: unknown): ClipboardHelperShape;
}

interface ComponentClassesShape {
  readonly "@mozilla.org/widget/clipboardhelper;1": ClipboardHelperClass;
}

interface ComponentInterfacesShape {
  readonly nsIClipboardHelper: unknown;
}

type CopyLinksState =
  import("@zen-mods/sine-lifecycle/sine-window").SineWindowGenerationState;

interface Window {
  zenCopyLinks?: CopyLinksState;
  addUnloadListener?: (callback: () => void) => void;
}

declare const ChromeUtils: ChromeUtilsShape;
declare const Cc: ComponentClassesShape;
declare const Ci: ComponentInterfacesShape;
