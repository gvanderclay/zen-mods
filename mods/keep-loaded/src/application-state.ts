/** The owner's internal bookkeeping shapes and the two keys its records use. */

import type {
  WakeCandidate,
  WakeTransactionOptions,
  WindowWorkDelegate,
  WorkReceipt,
  WorkResult,
} from "./application-protocol.ts";

export const SWEEP_KEY = Symbol("keep-loaded-sweep");
export const PULSE_KEY = Symbol("keep-loaded-pulse");

export interface DeferredReceipt {
  readonly public: WorkReceipt;
  readonly promise: Promise<WorkResult>;
  readonly settle: (result: WorkResult) => void;
  readonly settled: () => boolean;
}

export interface RegistrationRecord<Tab extends object, Evidence> {
  active: boolean;
  readonly delegate: WindowWorkDelegate<Tab, Evidence>;
  readonly id: string;
  readonly token: object;
}

export interface SweepRequest {
  readonly kind: "sweep";
  readonly receipt: DeferredReceipt;
}

export interface PulseRequest {
  readonly kind: "pulse";
  readonly receipt: DeferredReceipt;
}

export interface RecoveryRequest<Tab extends object, Evidence> {
  evidence: Evidence;
  readonly kind: "recovery";
  readonly receipt: DeferredReceipt;
  registration: RegistrationRecord<Tab, Evidence>;
  readonly tab: Tab;
}

export type WorkRequest<Tab extends object, Evidence> =
  | RecoveryRequest<Tab, Evidence>
  | PulseRequest
  | SweepRequest;

interface QueuedRecord<Tab extends object, Evidence> {
  request: WorkRequest<Tab, Evidence>;
  readonly state: "queued";
}

export interface ActiveInvocation<Tab extends object, Evidence> {
  readonly abort: AbortController;
  readonly registration: RegistrationRecord<Tab, Evidence>;
  readonly token: object;
}

export interface ActiveRecord<Tab extends object, Evidence> {
  canceled: boolean;
  detached: boolean;
  draining: boolean;
  failed: boolean;
  invocation: ActiveInvocation<Tab, Evidence> | null;
  readonly key: typeof SWEEP_KEY | typeof PULSE_KEY | Tab;
  readonly operationToken: object;
  readonly request: WorkRequest<Tab, Evidence>;
  readonly state: "active";
  pendingResult: WorkResult | null;
  trailing: WorkRequest<Tab, Evidence> | null;
}

export type KeyRecord<Tab extends object, Evidence> =
  | ActiveRecord<Tab, Evidence>
  | QueuedRecord<Tab, Evidence>;

export type WakePhase =
  | Readonly<{ kind: "acquiring" }>
  | Readonly<{
      kind: "blocked";
      resume: "restoring-preference" | "rolling-back";
    }>
  | Readonly<{ kind: "inserting" }>
  | Readonly<{ kind: "restoring-preference" }>
  | Readonly<{ kind: "retrying" }>
  | Readonly<{ kind: "rolling-back" }>
  | Readonly<{ kind: "waiting" }>;

export interface OwnedWakeCandidate {
  readonly candidate: WakeCandidate;
  invalidated: boolean;
}

export interface WakeTimer {
  handle: unknown;
  readonly token: object;
}

export interface WakeTransaction<Tab extends object, Evidence> {
  advancing: boolean;
  blockedArmFallbackUsed: boolean;
  attempt: number;
  attemptFailed: boolean;
  canceled: boolean;
  closed: boolean;
  deadline: number;
  failed: boolean;
  needsAdvance: boolean;
  readonly invocation: ActiveInvocation<Tab, Evidence>;
  readonly operation: ActiveRecord<Tab, Evidence>;
  readonly options: WakeTransactionOptions;
  readonly original: boolean;
  readonly owned: Map<object, OwnedWakeCandidate>;
  phase: WakePhase;
  readonly receipt: DeferredReceipt;
  readonly remaining: Map<object, WakeCandidate>;
  timer: WakeTimer | null;
}
