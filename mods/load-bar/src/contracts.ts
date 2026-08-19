import type { TimerPort } from "@zen-mods/sine-lifecycle/generation-scope";
import type { SineWindowGenerationStopReason } from "@zen-mods/sine-lifecycle/sine-window";
import type { ActivityState, TerminalOutcome } from "./core/activity.ts";
import type { LoadBarSettings } from "./core/settings.ts";

export type LoadBarStopReason = SineWindowGenerationStopReason | "platform-failure";

export type BrowserProgressEvent<Browser extends object> =
  | { readonly kind: "begin"; readonly browser: Browser }
  | {
      readonly kind: "finish";
      readonly browser: Browser;
      readonly outcome: TerminalOutcome;
    };

export interface BrowserProgressSource<Browser extends object> {
  install(listener: (event: BrowserProgressEvent<Browser>) => void): () => unknown;
  currentLoadingBrowsers(): readonly Browser[];
}

export interface BrowserVisibilitySource<Browser extends object> {
  install(listener: (browsers: readonly Browser[]) => void): () => unknown;
  currentBrowsers(): readonly Browser[];
}

export interface ActivityView {
  render(state: ActivityState): void;
  updateSettings(settings: LoadBarSettings): void;
  dispose(): void;
}

export interface TerminalDelays {
  readonly success: number;
  readonly canceled: number;
  readonly "network-error": number;
}

export interface LoadBarControllerOptions<Browser extends object> {
  readonly createView: (browser: Browser, settings: LoadBarSettings) => ActivityView;
  readonly isBrowserLive: (browser: Browser) => boolean;
  readonly onError?: (error: unknown) => void;
  readonly progress: BrowserProgressSource<Browser>;
  readonly settings: LoadBarSettings;
  readonly terminalDelayMs: TerminalDelays;
  readonly timers: TimerPort;
  readonly visibility: BrowserVisibilitySource<Browser>;
}

export interface LoadBarControllerSnapshot {
  readonly activeRecords: number;
  readonly live: boolean;
  readonly pendingTimers: number;
  readonly pendingWaits: number;
  readonly started: boolean;
  readonly stopReason: LoadBarStopReason | null;
  readonly visibleRecords: number;
}
