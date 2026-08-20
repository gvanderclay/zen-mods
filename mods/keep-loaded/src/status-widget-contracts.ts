/** The per-window adapter contract for the application-global status widget. */

/** The stable owner invokes a live window host only at first/last lease edges. */
export interface StatusWidgetViewEvent {
  readonly target: Element;
}

export type StatusWidgetViewShowing = (event: StatusWidgetViewEvent) => void;

export interface StatusWidgetHost {
  /** The stable owner supplies this dispatcher to the physical widget exactly once. */
  create(onViewShowing: StatusWidgetViewShowing): void;
  destroy(): void;
  /** Terminates this exact window generation if its deferred creation fails. */
  fail?(error: unknown): void;
  /** Handles an event only when it targets this live window's exact panel view. */
  show(event: StatusWidgetViewEvent): boolean;
}

export interface StatusWidgetLease {
  release(): boolean;
}
