export interface CloseCandidateSet<Candidate> {
  ordinary: readonly Candidate[];
  pinned: readonly Candidate[];
}

export type PinnedCloseChoice = "include-pinned" | "ignore-pinned" | "cancel";

export type CloseIntent =
  | { kind: "none" }
  | { kind: "close-ordinary" }
  | { kind: "prompt"; ordinaryCount: number; pinnedCount: number };

export const pinnedCloseChoiceFromPromptResult = (button: unknown): PinnedCloseChoice => {
  if (button === 0) {
    return "include-pinned";
  }
  if (button === 1) {
    return "ignore-pinned";
  }
  return "cancel";
};

export const closeIntent = (
  includePinned: boolean,
  promptAvailable: boolean,
  candidates: CloseCandidateSet<unknown>,
): CloseIntent => {
  if (includePinned && promptAvailable && candidates.pinned.length > 0) {
    return {
      kind: "prompt",
      ordinaryCount: candidates.ordinary.length,
      pinnedCount: candidates.pinned.length,
    };
  }
  if (candidates.ordinary.length > 0) {
    return { kind: "close-ordinary" };
  }
  return { kind: "none" };
};

export const closeCandidatesForChoice = <Candidate>(
  choice: PinnedCloseChoice,
  freshCandidates: CloseCandidateSet<Candidate>,
) => {
  if (choice === "include-pinned") {
    return [...freshCandidates.ordinary, ...freshCandidates.pinned];
  }
  if (choice === "ignore-pinned") {
    return [...freshCandidates.ordinary];
  }
  return [];
};
