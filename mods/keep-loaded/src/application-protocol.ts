/** The contract every window generation and the stable owner must agree on. */

import type { PulseSchedule } from "./core/pulse-scheduler.ts";
import type { StatusWidgetHost, StatusWidgetLease } from "./status-widget-contracts.ts";

/** Bump when the cached stable-owner contract or implementation changes. */
export const APPLICATION_COORDINATOR_PROTOCOL = 10 as const;

export type WorkResult = "canceled" | "completed" | "failed";

export interface WorkReceipt {
  readonly done: Promise<WorkResult>;
}

export type WakeCandidateState = "gone" | "inserted-pending" | "lazy" | "started";

export interface WakeCandidate {
  readonly key: object;
  insert(): void;
  rollback(): boolean;
  state(): WakeCandidateState;
}

export interface WakeTransactionOptions {
  readonly pollMs: number;
  readonly retryLimit: number;
  readonly timeoutMs: number;
}

export type ApplicationDisposeReason = "generation-ended" | "window-closed";

export interface WorkContext {
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  readOnDemand(): boolean;
  reconcileOnDemand(value: boolean): void;
  wakeCandidates(
    candidates: readonly WakeCandidate[],
    options: WakeTransactionOptions,
  ): Promise<WorkResult>;
}

export interface WindowWorkDelegate<Tab extends object, Evidence> {
  isLive(): boolean;
  sweep(context: WorkContext): Promise<void> | void;
  pulse?(context: WorkContext): Promise<void> | void;
  recover(context: WorkContext, tab: Tab, evidence: Evidence): Promise<void> | void;
  /** Re-renders this window's current status view after application-wide state changes. */
  refreshStatusPanel?(): void;
  reportError(error: unknown): void;
}

export interface ApplicationRegistration<Tab extends object, Evidence> {
  readonly id: string;
  acquireStatusWidget(host: StatusWidgetHost): StatusWidgetLease;
  requestSweep(): WorkReceipt;
  requestPulse(): WorkReceipt;
  setPulseSchedule(schedule: PulseSchedule): void;
  requestRecovery(tab: Tab, evidence: Evidence): WorkReceipt;
  /** The stable, Keep Loaded-only crash budget for this exact tab identity. */
  recentRecoveryAttempts(tab: Tab, now: number, windowMs: number): readonly number[];
  chargeRecoveryAttempt(
    tab: Tab,
    at: number,
    windowMs: number,
  ): readonly number[] | false;
  hasRecoveryAttempts(): boolean;
  resetRecoveryAttempts(): boolean;
  cancelRecovery(tab: Tab): boolean;
  invalidateTab(tab: Tab): boolean;
  reconcileOnDemand(value: boolean): boolean;
  isApplicationBusy(): boolean;
  dispose(reason?: ApplicationDisposeReason): boolean;
}
