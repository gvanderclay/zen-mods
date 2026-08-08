/** Narrow hand-authored types for the privileged Firefox/Zen APIs this mod uses. */

interface XulElement extends Element {
  hidden: boolean;
}

interface Document {
  createXULElement(tagName: string): XulElement;
}

interface SidebarContextMenuCustomizerState {
  disposers: Array<() => void>;
}

interface Window {
  zenSidebarContextMenuCustomizer?: SidebarContextMenuCustomizerState;
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
