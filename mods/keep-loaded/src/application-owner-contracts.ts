/** What a caller needs to construct and question the application-global owner. */

import type {
  ApplicationRegistration,
  WindowWorkDelegate,
} from "./application-protocol.ts";

export interface ApplicationPreferencesPort {
  readOnDemand(): boolean;
  writeOnDemand(value: boolean): void;
}

export interface ApplicationTimerPort {
  clearTimeout(handle: unknown): void;
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
}

export interface ApplicationOwnerSnapshot {
  readonly activeCount: number;
  readonly activeKind: "pulse" | "recovery" | "sweep" | null;
  readonly applicationId: string;
  readonly drainingCount: number;
  readonly keyRecords: number;
  readonly protocol: number;
  readonly readyCount: number;
  readonly recoveryAttempts: number;
  readonly registrationCount: number;
  readonly registrationIds: readonly string[];
  readonly statusWidgetLeaseIds: readonly string[];
  readonly statusWidgetLeases: number;
  readonly statusWidgetPhase: "absent" | "creating" | "destroying" | "present";
  readonly sweepRecords: number;
  readonly trailingCount: number;
  readonly desiredOnDemand: boolean | null;
  readonly wakeAttempt: number | null;
  readonly wakeCandidates: number;
  readonly wakeRetryScheduled: boolean;
  readonly wakePhase:
    | "acquiring"
    | "blocked"
    | "idle"
    | "inserting"
    | "restoring-preference"
    | "retrying"
    | "rolling-back"
    | "waiting";
}

export interface ApplicationOwnerOptions {
  applicationId: string;
  preferences: ApplicationPreferencesPort;
  reportError?: (error: unknown) => unknown;
  timers: ApplicationTimerPort;
}

export interface ApplicationOwnerApi<Tab extends object, Evidence> {
  register(
    delegate: WindowWorkDelegate<Tab, Evidence>,
  ): ApplicationRegistration<Tab, Evidence>;
  snapshot(): ApplicationOwnerSnapshot;
}
