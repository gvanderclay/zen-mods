import { bench, describe } from "vitest";

interface FixtureTab {
  readonly id: number;
  readonly pending: boolean;
  readonly url: string;
}

interface FixtureFacts {
  readonly pending: boolean;
  readonly score: number;
  readonly url: string;
}

const BENCHMARK = {
  iterations: 2_000,
  time: 0,
  warmupIterations: 200,
  warmupTime: 0,
};
const RECORDS_PER_SAMPLE = 25_000;

let _checksum = 0;

const invariant = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(`Invalid benchmark fixture: ${message}`);
  }
};

const tabsOf = (size: number): readonly FixtureTab[] =>
  Object.freeze(
    Array.from({ length: size }, (_, id) =>
      Object.freeze({
        id,
        pending: id % 7 === 0,
        url: `https://example.test/tab/${id}`,
      }),
    ),
  );

const inspect = (tabs: readonly FixtureTab[]): FixtureFacts[] =>
  tabs.map(tab => ({
    pending: tab.pending,
    score: tab.id * 3 + tab.url.length,
    url: tab.url,
  }));

const consume = (facts: readonly FixtureFacts[]): number => {
  let checksum = 0;
  for (const item of facts) {
    checksum += item.score + (item.pending ? 1 : 0) + item.url.length;
  }
  return checksum;
};

describe.each([20, 100, 500])("Keep Loaded inventory model / %i tabs", size => {
  const tabs = tabsOf(size);
  const batchesPerSample = RECORDS_PER_SAMPLE / size;
  const expected = consume(inspect(tabs)) * 3;

  invariant(tabs.length === size, "inventory size must match the requested fixture");
  invariant(Number.isInteger(batchesPerSample), `${size} must divide the sample size`);
  invariant(
    tabs.some(tab => tab.pending) && tabs.some(tab => !tab.pending),
    "inventory must mix awake and sleeping tabs",
  );

  bench(
    `inspect three times per batch (${batchesPerSample} batches)`,
    () => {
      for (let batch = 0; batch < batchesPerSample; batch += 1) {
        _checksum =
          consume(inspect(tabs)) + consume(inspect(tabs)) + consume(inspect(tabs));
      }
    },
    BENCHMARK,
  );

  bench(
    `inspect once per batch and reuse facts (${batchesPerSample} batches)`,
    () => {
      for (let batch = 0; batch < batchesPerSample; batch += 1) {
        const facts = inspect(tabs);
        _checksum = consume(facts) + consume(facts) + consume(facts);
      }
    },
    BENCHMARK,
  );

  invariant(
    consume(inspect(tabs)) * 3 === expected,
    "both benchmark variants must produce the same observable checksum",
  );
});
