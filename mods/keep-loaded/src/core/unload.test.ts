import { describe, expect, it } from "vitest";
import { type UnloadFacts, unloadPlan } from "./unload.ts";

const facts = (over: Partial<UnloadFacts> = {}): UnloadFacts => ({
  url: "https://app.slack.com/client/T07/D09",
  kept: true,
  busy: false,
  ...over,
});

describe("unloadPlan", () => {
  it("wakes a kept tab that something else unloaded", () => {
    const plan = unloadPlan(facts());
    expect(plan.action).toBe("wake");
  });

  it("names the tab it is waking, since the unload was not the mod's idea", () => {
    const plan = unloadPlan(facts());
    expect(plan.action === "wake" && plan.message).toContain("app.slack.com");
  });

  it("ignores a tab it does not keep", () => {
    // Zen's unload commands take a whole space at a time. Reporting every tab in it
    // would bury the one line that matters.
    expect(unloadPlan(facts({ kept: false })).action).toBe("ignore");
  });

  it("queues a discard while work is running, because only the exact owned recovery is ignored", () => {
    const plan = unloadPlan(facts({ busy: true }));
    expect(plan.action).toBe("wake");
    expect(plan.action === "wake" && plan.message).toContain("queuing");
  });

  it("gives a reason for every refusal, so a quiet log is explainable", () => {
    const plan = unloadPlan(facts({ kept: false }));
    expect(plan.action === "ignore" && plan.reason.length).toBeGreaterThan(0);
  });
});
