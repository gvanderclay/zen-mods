import {
  type CloseCandidateSet,
  closeCandidatesForChoice,
  closeIntent,
  type PinnedCloseChoice,
  pinnedCloseChoiceFromPromptResult,
} from "../core/pinned-close.ts";

interface NativePrompt {
  readonly BUTTON_POS_0: number;
  readonly BUTTON_POS_1: number;
  readonly BUTTON_POS_2: number;
  readonly BUTTON_TITLE_IS_STRING: number;
  readonly BUTTON_TITLE_CANCEL: number;
  readonly BUTTON_POS_1_DEFAULT: number;
  confirmEx(
    parent: unknown,
    title: string,
    text: string,
    flags: number,
    button0: string | null,
    button1: string | null,
    button2: string | null,
    checkMessage: string | null,
    checkState: Record<string, unknown>,
  ): unknown;
}

interface PinnedCloseCounts {
  ordinaryCount: number;
  pinnedCount: number;
}

const duplicatesLabel = (count: number, kind: "ordinary" | "pinned") =>
  `${count} ${kind} ${count === 1 ? "duplicate" : "duplicates"}`;

/**
 * `tabbrowser.js` 4884–4900 builds and opens Firefox's native `confirmEx` alert with
 * prompt-service button flags. This uses the same surface, while keeping Ignore
 * pinned in position 1 as the explicit default.
 */
export const confirmPinnedClose = (
  counts: PinnedCloseCounts,
  prompt: NativePrompt,
  parent: unknown,
): PinnedCloseChoice => {
  const flags =
    prompt.BUTTON_POS_0 * prompt.BUTTON_TITLE_IS_STRING +
    prompt.BUTTON_POS_1 * prompt.BUTTON_TITLE_IS_STRING +
    prompt.BUTTON_POS_2 * prompt.BUTTON_TITLE_CANCEL +
    prompt.BUTTON_POS_1_DEFAULT;
  const result = prompt.confirmEx(
    parent,
    "Close duplicate tabs?",
    `This folder has ${duplicatesLabel(counts.ordinaryCount, "ordinary")} and ${duplicatesLabel(counts.pinnedCount, "pinned")}.`,
    flags,
    "Include pinned",
    "Ignore pinned",
    null,
    null,
    {},
  );
  return pinnedCloseChoiceFromPromptResult(result);
};

interface RunPinnedCloseOptions<Candidate> {
  includePinned: boolean;
  promptAvailable: boolean;
  initial: CloseCandidateSet<Candidate>;
  refresh: () => CloseCandidateSet<Candidate>;
  prompt: (counts: PinnedCloseCounts) => PinnedCloseChoice;
  close: (candidates: Candidate[]) => void;
}

export const runPinnedClose = <Candidate>({
  includePinned,
  promptAvailable,
  initial,
  refresh,
  prompt,
  close,
}: RunPinnedCloseOptions<Candidate>) => {
  const intent = closeIntent(includePinned, promptAvailable, initial);
  if (intent.kind === "none") {
    return false;
  }
  if (intent.kind === "close-ordinary") {
    close([...initial.ordinary]);
    return initial.ordinary.length > 0;
  }

  const choice = prompt(intent);
  if (choice === "cancel") {
    return false;
  }
  const freshCandidates = closeCandidatesForChoice(choice, refresh());
  if (freshCandidates.length === 0) {
    return false;
  }
  close(freshCandidates);
  return true;
};
