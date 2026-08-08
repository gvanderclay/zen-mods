import { describe, expect, it } from "vitest";
import {
  closeCandidatesForChoice,
  closeIntent,
  pinnedCloseChoiceFromPromptResult,
} from "./pinned-close.ts";

const plan = (ordinary: string[], pinned: string[]) => ({
  ordinary,
  pinned,
});

describe("pinnedCloseChoiceFromPromptResult", () => {
  it("maps the three native buttons and treats dismissal or invalid values as cancel", () => {
    expect(pinnedCloseChoiceFromPromptResult(0)).toBe("include-pinned");
    expect(pinnedCloseChoiceFromPromptResult(1)).toBe("ignore-pinned");
    expect(pinnedCloseChoiceFromPromptResult(2)).toBe("cancel");
    expect(pinnedCloseChoiceFromPromptResult(-1)).toBe("cancel");
    expect(pinnedCloseChoiceFromPromptResult("0")).toBe("cancel");
    expect(pinnedCloseChoiceFromPromptResult(undefined)).toBe("cancel");
  });
});

describe("closeIntent", () => {
  it("closes ordinary candidates without prompting when pinned participation is off", () => {
    expect(closeIntent(false, true, plan(["ordinary"], ["pinned"]))).toEqual({
      kind: "close-ordinary",
    });
  });

  it("does not prompt for an ordinary-only plan", () => {
    expect(closeIntent(true, true, plan(["ordinary"], []))).toEqual({
      kind: "close-ordinary",
    });
  });

  it("prompts for pins-only and mixed plans when the prompt API is available", () => {
    expect(closeIntent(true, true, plan([], ["pinned"]))).toEqual({
      kind: "prompt",
      ordinaryCount: 0,
      pinnedCount: 1,
    });
    expect(closeIntent(true, true, plan(["ordinary"], ["pin-1", "pin-2"]))).toEqual({
      kind: "prompt",
      ordinaryCount: 1,
      pinnedCount: 2,
    });
  });

  it("falls back to ordinary-only closing when the prompt API is unavailable", () => {
    expect(closeIntent(true, false, plan(["ordinary"], ["pinned"]))).toEqual({
      kind: "close-ordinary",
    });
    expect(closeIntent(true, false, plan([], ["pinned"]))).toEqual({ kind: "none" });
  });

  it("does nothing for an empty plan", () => {
    expect(closeIntent(true, true, plan([], []))).toEqual({ kind: "none" });
  });
});

describe("closeCandidatesForChoice", () => {
  const freshPlan = plan(["ordinary"], ["pin-1", "pin-2"]);

  it("includes both fresh categories only after Include pinned", () => {
    expect(closeCandidatesForChoice("include-pinned", freshPlan)).toEqual([
      "ordinary",
      "pin-1",
      "pin-2",
    ]);
  });

  it("never introduces pinned candidates after Ignore pinned", () => {
    expect(closeCandidatesForChoice("ignore-pinned", freshPlan)).toEqual(["ordinary"]);
  });

  it("returns no candidates after Cancel", () => {
    expect(closeCandidatesForChoice("cancel", freshPlan)).toEqual([]);
  });
});
