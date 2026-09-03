export interface PropertySnapshot {
  readonly value: string;
  readonly priority: string;
}

export interface PropertyOwnership {
  readonly baseline: PropertySnapshot;
  readonly applied: PropertySnapshot;
}

export interface PropertyApplyPlan {
  readonly ownership: PropertyOwnership;
  readonly write: boolean;
}

export type PropertyRestorePlan =
  | { readonly kind: "leave" }
  | { readonly kind: "restore"; readonly value: PropertySnapshot };

const equal = (left: PropertySnapshot, right: PropertySnapshot): boolean =>
  left.value === right.value && left.priority === right.priority;

export const planPropertyApply = (
  previous: PropertyOwnership | undefined,
  current: PropertySnapshot,
  next: PropertySnapshot,
): PropertyApplyPlan => ({
  ownership: {
    baseline: previous && equal(current, previous.applied) ? previous.baseline : current,
    applied: next,
  },
  write: !equal(current, next),
});

export const planPropertyRestore = (
  ownership: PropertyOwnership,
  current: PropertySnapshot,
): PropertyRestorePlan =>
  equal(current, ownership.applied)
    ? { kind: "restore", value: ownership.baseline }
    : { kind: "leave" };
