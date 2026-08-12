import { describe, expect, it } from "vitest";
import { type ActivityState, IDLE_ACTIVITY, reduceActivity } from "./activity.ts";

const begin = (token: number): ActivityState =>
  reduceActivity(IDLE_ACTIVITY, { kind: "begin", token });

describe("activity state", () => {
  it("waits without becoming visible when a navigation begins", () => {
    expect(begin(1)).toEqual({ kind: "waiting", token: 1 });
  });

  it("reveals only the current navigation", () => {
    const waiting = begin(2);
    expect(reduceActivity(waiting, { kind: "reveal", token: 2 })).toEqual({
      kind: "visible",
      token: 2,
    });
    expect(reduceActivity(waiting, { kind: "reveal", token: 1 })).toBe(waiting);
  });

  it("keeps short successful and failed navigations invisible", () => {
    for (const outcome of ["success", "canceled", "network-error"] as const) {
      expect(reduceActivity(begin(3), { kind: "finish", token: 3, outcome })).toBe(
        IDLE_ACTIVITY,
      );
    }
  });

  it("preserves the semantic terminal outcome after reveal", () => {
    const visible = reduceActivity(begin(4), { kind: "reveal", token: 4 });

    expect(
      reduceActivity(visible, { kind: "finish", token: 4, outcome: "success" }),
    ).toEqual({ kind: "completing", token: 4, outcome: "success" });
    for (const outcome of ["canceled", "network-error"] as const) {
      expect(reduceActivity(visible, { kind: "finish", token: 4, outcome })).toEqual({
        kind: "canceling",
        token: 4,
        outcome,
      });
    }
  });

  it("settles only the matching terminal navigation", () => {
    const terminal = reduceActivity(
      reduceActivity(begin(5), { kind: "reveal", token: 5 }),
      { kind: "finish", token: 5, outcome: "success" },
    );
    expect(reduceActivity(terminal, { kind: "settle", token: 4 })).toBe(terminal);
    expect(reduceActivity(terminal, { kind: "settle", token: 5 })).toBe(IDLE_ACTIVITY);
  });

  it("lets a new navigation supersede every earlier phase", () => {
    const phases: ActivityState[] = [
      begin(6),
      { kind: "visible", token: 6 },
      { kind: "completing", token: 6, outcome: "success" },
      { kind: "canceling", token: 6, outcome: "network-error" },
    ];

    for (const phase of phases) {
      const current = reduceActivity(phase, { kind: "begin", token: 7 });
      expect(current).toEqual({ kind: "waiting", token: 7 });
      expect(
        reduceActivity(current, {
          kind: "finish",
          token: 6,
          outcome: "success",
        }),
      ).toBe(current);
      expect(reduceActivity(current, { kind: "settle", token: 6 })).toBe(current);
    }
  });
});
