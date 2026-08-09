import { bench, describe } from "vitest";

import {
  type PulseFacts,
  type PulseOutcome,
  parsePulseSettings,
  pulseStep,
  pulseSummary,
} from "../src/core/freshness.ts";
import { type SocketRecord, socketSummary } from "../src/core/sockets.ts";

const NOW = 2_000_000;
const SETTINGS = { everyMs: 120_000, holdMs: 5_000 };
const BENCHMARK = {
  iterations: 2_000,
  time: 0,
  warmupIterations: 200,
  warmupTime: 0,
};
const RECORDS_PER_SAMPLE = 25_000;

let _result: unknown;

const invariant = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(`Invalid benchmark fixture: ${message}`);
  }
};

const pulseFacts = (size: number): PulseFacts[] =>
  Array.from({ length: size }, (_, index) => {
    const heldSince =
      index % 7 === 0 ? NOW - 6_000 : index % 11 === 0 ? NOW - 1_000 : null;
    return {
      active: heldSince !== null || index % 17 === 0,
      heldSince,
      kept: index % 19 !== 0,
      lastPulseAt: index % 5 === 0 ? NOW - 130_000 : NOW - 1_000,
      pending: index % 23 === 0,
      selected: index % 13 === 0,
      url: `https://example.com/tab/${index}`,
    };
  });

const socketRecords = (size: number): SocketRecord[] =>
  Array.from({ length: size }, (_, index) => ({
    framesIn: index % 5,
    framesOut: index % 3,
    lastFrameAt: index % 11 === 0 ? null : NOW - index * 1_000,
    open: index % 2,
    space: `space-${index % 10}`,
    url: `https://example.com/tab/${index}`,
    watching: index % 7 !== 0,
  }));

describe.each([20, 100, 500])("Keep Loaded core / %i tabs", size => {
  const facts = pulseFacts(size);
  const outcomes: PulseOutcome[] = facts.map(item => ({
    step: pulseStep(item, SETTINGS, NOW),
    url: item.url,
  }));
  const sockets = socketRecords(size);
  const batchesPerSample = RECORDS_PER_SAMPLE / size;

  invariant(Number.isInteger(batchesPerSample), `${size} must divide the sample size`);
  invariant(
    new Set(facts.map(item => item.url)).size === size,
    "tab URLs must be unique",
  );
  invariant(
    ["activate", "release", "forget", "skip"].every(action =>
      outcomes.some(outcome => outcome.step.action === action),
    ),
    `${size}-tab pulse fixture must exercise every action`,
  );
  invariant(
    sockets.some(record => record.watching) &&
      sockets.some(record => !record.watching) &&
      sockets.some(record => record.lastFrameAt === null) &&
      sockets.some(record => record.lastFrameAt !== null),
    `${size}-tab socket fixture must mix watched and heard-from states`,
  );

  bench(
    `evaluate ${RECORDS_PER_SAMPLE} pulse decisions/sample (${batchesPerSample} batches)`,
    () => {
      for (let batch = 0; batch < batchesPerSample; batch += 1) {
        _result = facts.map(item => pulseStep(item, SETTINGS, NOW));
      }
    },
    BENCHMARK,
  );

  bench(
    `summarize ${RECORDS_PER_SAMPLE} pulse outcomes/sample (${batchesPerSample} batches)`,
    () => {
      for (let batch = 0; batch < batchesPerSample; batch += 1) {
        _result = pulseSummary(outcomes);
      }
    },
    BENCHMARK,
  );

  bench(
    `summarize ${RECORDS_PER_SAMPLE} socket records/sample (${batchesPerSample} batches)`,
    () => {
      for (let batch = 0; batch < batchesPerSample; batch += 1) {
        _result = socketSummary(sockets, NOW);
      }
    },
    BENCHMARK,
  );
});

const settingPairs = Array.from(
  { length: 100 },
  (_, index) =>
    [
      index % 9 === 0 ? " invalid " : ` ${index * 3} `,
      index % 7 === 0 ? "" : ` ${index % 30} `,
    ] as const,
);
const settingBatchesPerSample = RECORDS_PER_SAMPLE / settingPairs.length;

invariant(
  Number.isInteger(settingBatchesPerSample),
  "setting-pair count must divide the sample size",
);
invariant(
  settingPairs.some(
    ([every, hold]) => every.trim() === "invalid" && hold.trim() === "",
  ) &&
    settingPairs.some(
      ([every, hold]) => every.trim() !== "invalid" && hold.trim() !== "",
    ),
  "setting fixture must mix invalid and valid pairs",
);

bench(
  `parse ${RECORDS_PER_SAMPLE} pulse-setting pairs/sample (${settingBatchesPerSample} batches)`,
  () => {
    for (let batch = 0; batch < settingBatchesPerSample; batch += 1) {
      for (const [every, hold] of settingPairs) {
        _result = parsePulseSettings(every, hold);
      }
    }
  },
  BENCHMARK,
);
