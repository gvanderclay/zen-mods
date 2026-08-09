import { bench, describe } from "vitest";

import {
  type CustomizationActionFacts,
  coalesceCustomizationActions,
  filterCustomizationActions,
  groupCustomizationActions,
  type MoreActionFacts,
  resolveMoreActions,
} from "../src/core/policy.ts";

const BENCHMARK = {
  iterations: 2_000,
  time: 0,
  warmupIterations: 200,
  warmupTime: 0,
};
const FILTER_ROWS_PER_SAMPLE = 5_000;
const POLICY_ROWS_PER_SAMPLE = 1_000;

let _result: unknown;

const invariant = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(`Invalid benchmark fixture: ${message}`);
  }
};

interface BenchmarkAction extends CustomizationActionFacts, MoreActionFacts {}

const actionInventory = (size: number): BenchmarkAction[] =>
  Array.from({ length: size }, (_, index) => ({
    browserVisible: index % 7 !== 0,
    key: `action-${index}`,
    label: `Action ${index % 10 === 1 ? index - 1 : index}`,
    selected: index % 3 === 0,
  }));

describe.each([25, 100])("Sidebar policy / %i actions", size => {
  const actions = actionInventory(size);
  const excluded = new Set(
    actions.filter(action => !action.selected).map(action => action.key),
  );
  const coalesced = coalesceCustomizationActions(actions);
  const labelCounts = new Map<string, number>();
  for (const action of actions) {
    const label = action.label.trim().toLowerCase();
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  const repeatedLabels = [...labelCounts.values()].filter(count => count > 1);
  const policyCallsPerSample = Math.ceil(POLICY_ROWS_PER_SAMPLE / actions.length);
  const policyRowsPerSample = policyCallsPerSample * actions.length;
  const filterCallsPerSample = Math.ceil(FILTER_ROWS_PER_SAMPLE / coalesced.length);
  const filterRowsPerSample = filterCallsPerSample * coalesced.length;

  invariant(
    new Set(actions.map(action => action.key)).size === size,
    "keys must be unique",
  );
  invariant(
    repeatedLabels.length > 0 && repeatedLabels.every(count => count === 2),
    `${size}-action fixture must contain same-label variant pairs`,
  );
  invariant(
    coalesced.length === labelCounts.size &&
      coalesced.reduce((count, action) => count + action.actions.length, 0) === size,
    `${size}-action fixture must coalesce without dropping variants`,
  );
  invariant(
    excluded.size > 0 && excluded.size < size,
    `${size}-action fixture must mix selected and excluded actions`,
  );
  invariant(
    filterCustomizationActions(coalesced, "action 2").length > 0,
    `${size}-action fixture must contain filter matches`,
  );

  bench(
    `resolve More actions for ${policyRowsPerSample} action facts/sample (${policyCallsPerSample} calls)`,
    () => {
      for (let call = 0; call < policyCallsPerSample; call += 1) {
        _result = resolveMoreActions(actions, excluded);
      }
    },
    BENCHMARK,
  );

  bench(
    `coalesce and group ${policyRowsPerSample} action facts/sample (${policyCallsPerSample} calls)`,
    () => {
      for (let call = 0; call < policyCallsPerSample; call += 1) {
        _result = groupCustomizationActions(coalesceCustomizationActions(actions));
      }
    },
    BENCHMARK,
  );

  bench(
    `filter ${filterRowsPerSample} editor rows/sample (${filterCallsPerSample} calls)`,
    () => {
      for (let call = 0; call < filterCallsPerSample; call += 1) {
        _result = filterCustomizationActions(coalesced, "action 2");
      }
    },
    BENCHMARK,
  );
});

const initialActions = actionInventory(100);
const lateActions = actionInventory(10).map((action, index) => ({
  ...action,
  key: `late-action-${index}`,
  label: `Late action ${index}`,
}));
const combinedActions = [...initialActions, ...lateActions];
const combinedExcluded = new Set(
  combinedActions.filter(action => !action.selected).map(action => action.key),
);
const initialKeys = new Set(initialActions.map(action => action.key));
const lateCallsPerSample = Math.ceil(POLICY_ROWS_PER_SAMPLE / combinedActions.length);
const lateRowsPerSample = lateCallsPerSample * combinedActions.length;

invariant(initialActions.length === 100, "initial inventory must contain 100 actions");
invariant(lateActions.length === 10, "late inventory must contain 10 actions");
invariant(
  lateActions.every(action => !initialKeys.has(action.key)) &&
    new Set(combinedActions.map(action => action.key)).size === combinedActions.length,
  "late fixture must model additions with keys distinct from the initial inventory",
);
invariant(
  lateActions.some(action => combinedExcluded.has(action.key)),
  "late additions must include an excluded action",
);

bench(
  `resolve ${lateRowsPerSample} action facts/sample after 10 late additions (${lateCallsPerSample} calls)`,
  () => {
    for (let call = 0; call < lateCallsPerSample; call += 1) {
      _result = resolveMoreActions(combinedActions, combinedExcluded);
    }
  },
  BENCHMARK,
);
