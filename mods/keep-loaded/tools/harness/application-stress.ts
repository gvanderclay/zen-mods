import {
  APPLICATION_COORDINATOR_PROTOCOL,
  KeepLoadedApplicationOwner,
  type WindowWorkDelegate,
  type WorkResult,
} from "../../src/application-coordinator.ts";
import { buildStressSchedule } from "./stress-core.mjs";

export { APPLICATION_COORDINATOR_PROTOCOL };

interface StressTab {
  readonly id: number;
}

interface StressEvidence {
  readonly revision: number;
}

interface ApplicationStressOptions {
  readonly events: number;
  readonly replayEvent: number | null;
  readonly seed: number;
  readonly tabs: number;
}

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(onResolve => {
    resolve = onResolve;
  });
  return { promise, resolve };
};

const scheduleHashes = (schedule: readonly unknown[]) => {
  let hash = 0x811c9dc5;
  const hashes: string[] = [];
  for (const event of schedule) {
    const text = `${JSON.stringify(event)}\n`;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    hashes.push((hash >>> 0).toString(16).padStart(8, "0"));
  }
  return hashes;
};

/** Run the actual production application owner under a seeded mixed-event burst. */
export const runApplicationStress = async ({
  events,
  replayEvent,
  seed,
  tabs: tabCount,
}: ApplicationStressOptions) => {
  const completeSchedule = buildStressSchedule({ count: events, seed, tabs: tabCount });
  const schedule = completeSchedule.slice(0, replayEvent ?? completeSchedule.length);
  const schedulePrefixHashes = scheduleHashes(completeSchedule);
  const scheduleHash = schedulePrefixHashes[schedule.length - 1] ?? "00000000";
  const tabs = Array.from({ length: tabCount }, (_, id) => Object.freeze({ id }));
  const errors: string[] = [];
  const trace: string[] = [];
  const traceEvent = (entry: string) => {
    trace.push(entry);
    if (trace.length > 200) trace.shift();
  };
  let onDemand = true;
  let expectedOnDemand = true;
  let delegateActive = 0;
  let maxActive = 0;
  let maxKeyRecords = 0;
  const firstStarted = deferred();
  const firstRelease = deferred();
  let holdFirstSweep = true;
  const owner = new KeepLoadedApplicationOwner<StressTab, StressEvidence>({
    applicationId: `stress-${seed}`,
    preferences: {
      readOnDemand: () => onDemand,
      writeOnDemand: value => {
        onDemand = value;
        traceEvent(`preference:${String(value)}`);
      },
    },
    reportError: error => errors.push(String(error)),
    timers: {
      clearTimeout,
      now: Date.now,
      setTimeout,
    },
  });

  const enter = async (label: string, hold = false) => {
    delegateActive += 1;
    maxActive = Math.max(maxActive, delegateActive);
    traceEvent(`start:${label}`);
    try {
      if (hold) {
        firstStarted.resolve();
        await firstRelease.promise;
      } else {
        await Promise.resolve();
      }
    } finally {
      traceEvent(`finish:${label}`);
      delegateActive -= 1;
    }
  };
  const delegate = (
    registration: number,
  ): WindowWorkDelegate<StressTab, StressEvidence> => ({
    isLive: () => true,
    pulse: () => enter(`pulse:${registration}`),
    recover: (_context, tab, evidence) =>
      enter(`recovery:${registration}:${tab.id}:${evidence.revision}`),
    reportError: error => errors.push(String(error)),
    sweep: () => {
      const hold = holdFirstSweep;
      holdFirstSweep = false;
      return enter(`sweep:${registration}`, hold);
    },
  });
  const registrations = [
    owner.register(delegate(0)),
    owner.register(delegate(1)),
    owner.register(delegate(2)),
  ] as const;
  const receipts: Array<Promise<WorkResult>> = [];
  receipts.push(registrations[0].requestSweep().done);
  await firstStarted.promise;

  for (const event of schedule) {
    const registration = registrations[event.registration];
    const tab = tabs[event.tab];
    if (!registration || !tab) {
      throw new RangeError(
        `stress schedule referenced an invalid owner at event ${event.index}`,
      );
    }
    traceEvent(`event:${event.index}:${event.kind}:${event.tab}`);
    switch (event.kind) {
      case "sweep":
        receipts.push(registration.requestSweep().done);
        break;
      case "recovery":
        receipts.push(
          registration.requestRecovery(tab, { revision: event.revision }).done,
        );
        break;
      case "pulse":
        receipts.push(registration.requestPulse().done);
        break;
      case "cancel":
        registration.cancelRecovery(tab);
        break;
      case "invalidate":
        registration.invalidateTab(tab);
        break;
      case "preference":
        expectedOnDemand = event.value;
        registration.reconcileOnDemand(event.value);
        break;
      default:
        event.kind satisfies never;
    }
    const snapshot = owner.snapshot();
    maxKeyRecords = Math.max(maxKeyRecords, snapshot.keyRecords);
    if (snapshot.activeCount > 1 || snapshot.keyRecords > tabCount + 2) {
      throw new Error(
        `owner invariant failed at event ${event.index}: ${JSON.stringify(snapshot)}`,
      );
    }
  }

  firstRelease.resolve();
  const results = await Promise.all(receipts);
  const beforeDispose = owner.snapshot();
  for (const registration of registrations) registration.dispose();
  const finalOwner = owner.snapshot();
  const resultCounts = { canceled: 0, completed: 0, failed: 0 };
  for (const result of results) resultCounts[result] += 1;

  return Object.freeze({
    completedEvents: schedule.length,
    errors,
    expectedEvents: schedule.length,
    finalOwner,
    maxActive,
    maxKeyRecords,
    preferenceDrift: onDemand !== expectedOnDemand,
    receipts: resultCounts,
    scheduleHash,
    schedulePrefixHash: scheduleHash,
    schedulePrefixHashes,
    seed,
    settledOwner: beforeDispose,
    traceTail: trace,
  });
};
