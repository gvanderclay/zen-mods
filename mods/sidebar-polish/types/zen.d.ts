/** Narrow hand-authored types for the privileged Firefox/Zen APIs this mod uses. */

interface LegacySidebarElement extends Element {
  hidden: boolean;
  readonly style: CSSStyleDeclaration;
}

interface LegacySidebarContentElement extends Element {
  readonly style: CSSStyleDeclaration;
}

interface LegacySidebarController {
  readonly currentID: string;
  readonly isOpen: boolean;
  readonly _animationDurationMs: number;
  readonly _animationEnabled: boolean;
  readonly _box: LegacySidebarElement;
  readonly _splitter: LegacySidebarElement;
  readonly browser: LegacySidebarContentElement;
  show(commandID?: string, triggerNode?: unknown): Promise<boolean>;
  showInitially(commandID: string): Promise<boolean>;
  hide(options?: { triggerNode?: unknown; dismissPanel?: boolean }): void;
}

type SidebarPolishGeneration =
  import("@zen-mods/sine-lifecycle/sine-window").SineWindowGenerationState;

interface Window {
  readonly gReduceMotion: boolean;
  zenSidebarPolish?: SidebarPolishGeneration;
  addUnloadListener?: (callback: () => void) => void;
}

declare const SidebarController: LegacySidebarController;
