import assert from "node:assert/strict";

import { bench, describe } from "vitest";

import { type DuplicateTabFacts, planDuplicates } from "../src/core/duplicates.ts";

const BENCHMARK = {
  iterations: 2_000,
  time: 0,
  warmupIterations: 200,
  warmupTime: 0,
};

let _result: unknown;

interface Workload {
  density: "dense" | "none" | "sparse";
  lanes: number;
  plansPerSample?: number;
  tabs: number;
}

const duplicateFacts = ({ density, lanes, tabs }: Workload): DuplicateTabFacts[] => {
  const facts: DuplicateTabFacts[] = [];
  for (let index = 0; index < tabs; index += 1) {
    const laneNumber = index % lanes;
    const position = Math.floor(index / lanes);
    const identity =
      density === "none"
        ? position
        : position < 4
          ? 0
          : density === "dense"
            ? Math.floor((position - 4) / 3) + 1
            : position % 10 < 2
              ? Math.floor(position / 10) + 1
              : position + 10_000;
    const pinnedFixtureTab = density !== "none" && position < 3;
    const pinned = pinnedFixtureTab || index % 17 === 0;
    const url = `https://example.com/page/${identity}`;
    facts.push({
      containerId: identity % 3,
      currentUrl: url,
      essential: pinnedFixtureTab && position < 2,
      id: `tab-${index}`,
      laneId: `lane-${laneNumber}`,
      lastSeenActive: 1_000_000 - ((index * 7_919) % 100_000),
      pinned,
      pinnedUrl: pinned ? url : null,
      position,
      spaceId: `space-${Math.floor(laneNumber / 10)}`,
    });
  }
  return facts;
};

const workloads: Array<Workload & { name: string }> = [
  {
    density: "sparse",
    lanes: 1,
    name: "20 tabs / 1 lane / sparse duplicates",
    plansPerSample: 50,
    tabs: 20,
  },
  {
    density: "none",
    lanes: 10,
    name: "100 tabs / 10 lanes / zero duplicates",
    plansPerSample: 20,
    tabs: 100,
  },
  {
    density: "sparse",
    lanes: 10,
    name: "100 tabs / 10 lanes / sparse duplicates",
    plansPerSample: 10,
    tabs: 100,
  },
  {
    density: "dense",
    lanes: 10,
    name: "100 tabs / 10 lanes / dense duplicates",
    plansPerSample: 10,
    tabs: 100,
  },
  {
    density: "dense",
    lanes: 50,
    name: "500 tabs / 50 lanes / dense duplicates",
    tabs: 500,
  },
  {
    density: "dense",
    lanes: 1,
    name: "500 tabs / 1 lane / dense duplicates",
    tabs: 500,
  },
];

describe.each(workloads)("Tab Deduplicator / $name", workload => {
  const facts = duplicateFacts(workload);
  const protectedPlan = planDuplicates(facts);
  const includedPlan = planDuplicates(facts, { includePinned: true });
  const plansPerSample = workload.plansPerSample ?? 1;

  if (workload.density === "none") {
    assert.equal(protectedPlan.clusters.length, 0, `${workload.name} must be unique`);
    assert.equal(includedPlan.clusters.length, 0, `${workload.name} must be unique`);

    bench(
      `plan zero-duplicate fixture (${plansPerSample} plans per sample)`,
      () => {
        for (let plan = 0; plan < plansPerSample; plan += 1) {
          _result = planDuplicates(facts);
        }
      },
      BENCHMARK,
    );
    return;
  }

  assert.ok(
    protectedPlan.clusters.length > 0,
    `${workload.name} must contain duplicates`,
  );
  assert.equal(
    protectedPlan.pinnedCandidateIds.length,
    0,
    `${workload.name} must protect pinned duplicates by default`,
  );
  assert.ok(
    protectedPlan.protectedDuplicateIds.length >
      includedPlan.protectedDuplicateIds.length,
    `${workload.name} must move non-essential pins from protected duplicates to candidates`,
  );
  assert.ok(
    includedPlan.pinnedCandidateIds.length > 0,
    `${workload.name} must yield pinned candidates when pins are included`,
  );
  assert.ok(
    includedPlan.protectedDuplicateIds.length > 0,
    `${workload.name} must retain essential protected duplicates when pins are included`,
  );

  bench(
    plansPerSample === 1
      ? "plan with pinned duplicates protected"
      : `plan with pinned duplicates protected (${plansPerSample} plans per sample)`,
    () => {
      for (let plan = 0; plan < plansPerSample; plan += 1) {
        _result = planDuplicates(facts);
      }
    },
    BENCHMARK,
  );

  bench(
    plansPerSample === 1
      ? "plan with pinned duplicate candidates included"
      : `plan with pinned duplicate candidates included (${plansPerSample} plans per sample)`,
    () => {
      for (let plan = 0; plan < plansPerSample; plan += 1) {
        _result = planDuplicates(facts, { includePinned: true });
      }
    },
    BENCHMARK,
  );
});
