import { describe, expect, it } from "vitest";
import {
  type PropertySnapshot,
  planPropertyApply,
  planPropertyRestore,
} from "./property-ledger.ts";

const snapshot = (value: string, priority = ""): PropertySnapshot => ({
  value,
  priority,
});

describe("style property ownership", () => {
  it("restores the latest native value observed before a reapply", () => {
    const first = planPropertyApply(
      undefined,
      snapshot("native-start"),
      snapshot("#112233", "important"),
    );
    expect(first).toEqual({
      ownership: {
        baseline: snapshot("native-start"),
        applied: snapshot("#112233", "important"),
      },
      write: true,
    });

    const second = planPropertyApply(
      first.ownership,
      snapshot("native-latest"),
      snapshot("#445566", "important"),
    );
    expect(planPropertyRestore(second.ownership, second.ownership.applied)).toEqual({
      kind: "restore",
      value: snapshot("native-latest"),
    });
  });

  it("leaves a value changed after the final palette apply untouched", () => {
    const applied = planPropertyApply(
      undefined,
      snapshot("native"),
      snapshot("#112233", "important"),
    );

    expect(
      planPropertyRestore(applied.ownership, snapshot("new-owner", "important")),
    ).toEqual({ kind: "leave" });
  });
});
