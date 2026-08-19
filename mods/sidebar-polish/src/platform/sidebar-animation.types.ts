export type SidebarMotionDirection = "close" | "open";

export interface SidebarMotionRun {
  readonly finished: Promise<void>;
  cancel(): void;
  start(): void;
}

export interface SidebarMotionPort {
  animate(direction: SidebarMotionDirection): SidebarMotionRun | null;
}

export interface LegacySidebarAnimationOptions {
  controller: LegacySidebarController;
  motion: SidebarMotionPort;
  reduceMotion(): boolean;
  report?(error: unknown): void;
}

export interface ClippedSidebarMotionOptions {
  box: LegacySidebarElement;
  durationMs: number;
  splitter: LegacySidebarElement;
  tabbox: Element;
}

export interface SavedStyle {
  readonly name: string;
  readonly priority: string;
  readonly value: string;
}

export interface PendingClose {
  readonly options?: { triggerNode?: unknown; dismissPanel?: boolean };
  readonly run: SidebarMotionRun;
  readonly token: object;
}

export interface ContentMask {
  restore(): void;
}
