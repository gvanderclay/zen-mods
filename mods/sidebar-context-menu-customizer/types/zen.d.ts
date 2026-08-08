/** Narrow hand-authored types for the privileged Firefox/Zen APIs this mod uses. */

interface XulElement extends Element {
  hidden: boolean;
}

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
  copyLink(node: Element): void;
  getLinksToShare(node: Element): Array<{ url: string; title: string }>;
}

interface ChromeUtilsShape {
  importESModule(specifier: string): { SharingUtils: SharingUtilsShape };
}

interface SidebarContextMenuCustomizerState {
  disposers: Array<() => void>;
}

interface TabContextMenuShape {
  contextTab?: Element | null;
}

interface Window {
  zenSidebarContextMenuCustomizer?: SidebarContextMenuCustomizerState;
  TabContextMenu?: TabContextMenuShape;
  addUnloadListener?: (callback: () => void) => void;
}

interface ServicesShape {
  prefs: {
    prefHasUserValue(name: string): boolean;
    getStringPref(name: string, fallback: string): string;
    setStringPref(name: string, value: string): void;
    setBoolPref(name: string, value: boolean): void;
  };
}

declare const Services: ServicesShape;
declare const ChromeUtils: ChromeUtilsShape;
