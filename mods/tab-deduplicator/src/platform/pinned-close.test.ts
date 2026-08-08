import { describe, expect, it, vi } from "vitest";
import { confirmPinnedClose, runPinnedClose } from "./pinned-close.ts";

const nativePrompt = (result: unknown) => ({
  BUTTON_POS_0: 1,
  BUTTON_POS_1: 2,
  BUTTON_POS_2: 3,
  BUTTON_TITLE_IS_STRING: 10,
  BUTTON_TITLE_CANCEL: 20,
  BUTTON_POS_1_DEFAULT: 1_000,
  confirmEx: vi.fn((..._args: unknown[]) => result),
});

describe("confirmPinnedClose", () => {
  it("shows three choices with Ignore pinned as the default", () => {
    const prompt = nativePrompt(1);

    expect(
      confirmPinnedClose(
        { ordinaryCount: 2, pinnedCount: 3 },
        prompt,
        "browser-window",
        "folder",
      ),
    ).toBe("ignore-pinned");
    expect(prompt.confirmEx).toHaveBeenCalledWith(
      "browser-window",
      "Close duplicate tabs?",
      "This folder has 2 ordinary duplicates and 3 pinned duplicates.",
      1 * 10 + 2 * 10 + 3 * 20 + 1_000,
      "Include pinned",
      "Ignore pinned",
      null,
      null,
      {},
    );
  });

  it("treats a dismissed prompt as Cancel", () => {
    expect(
      confirmPinnedClose(
        { ordinaryCount: 0, pinnedCount: 1 },
        nativePrompt(-1),
        null,
        "folder",
      ),
    ).toBe("cancel");
  });

  it("describes an aggregate space plan without changing the choices", () => {
    const prompt = nativePrompt(0);

    expect(
      confirmPinnedClose(
        { ordinaryCount: 1, pinnedCount: 4 },
        prompt,
        "browser-window",
        "space",
      ),
    ).toBe("include-pinned");
    expect(prompt.confirmEx.mock.calls[0]?.[2]).toBe(
      "This space has 1 ordinary duplicate and 4 pinned duplicates.",
    );
  });
});

describe("runPinnedClose", () => {
  it("recomputes after Include pinned and closes both fresh categories", () => {
    const ordinary = { id: "ordinary" };
    const oldPin = { id: "old-pin" };
    const freshPin = { id: "fresh-pin" };
    const refresh = vi.fn(() => ({ ordinary: [ordinary], pinned: [freshPin] }));
    const close = vi.fn();

    expect(
      runPinnedClose({
        includePinned: true,
        promptAvailable: true,
        initial: { ordinary: [], pinned: [oldPin] },
        refresh,
        prompt: () => "include-pinned",
        close,
      }),
    ).toBe(true);
    expect(refresh).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith([ordinary, freshPin]);
  });

  it("cannot introduce pinned tabs after Ignore pinned", () => {
    const ordinary = { id: "ordinary" };
    const freshPin = { id: "fresh-pin" };
    const close = vi.fn();

    runPinnedClose({
      includePinned: true,
      promptAvailable: true,
      initial: { ordinary: [], pinned: [{ id: "old-pin" }] },
      refresh: () => ({ ordinary: [ordinary], pinned: [freshPin] }),
      prompt: () => "ignore-pinned",
      close,
    });

    expect(close).toHaveBeenCalledWith([ordinary]);
  });

  it("does not refresh or close after Cancel", () => {
    const refresh = vi.fn(() => ({ ordinary: [], pinned: [] }));
    const close = vi.fn();

    expect(
      runPinnedClose({
        includePinned: true,
        promptAvailable: true,
        initial: { ordinary: [], pinned: [{ id: "pin" }] },
        refresh,
        prompt: () => "cancel",
        close,
      }),
    ).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("closes only ordinary tabs without a prompt when pinned support is unavailable", () => {
    const ordinary = { id: "ordinary" };
    const prompt = vi.fn(() => "include-pinned" as const);
    const close = vi.fn();

    runPinnedClose({
      includePinned: true,
      promptAvailable: false,
      initial: { ordinary: [ordinary], pinned: [{ id: "pin" }] },
      refresh: () => ({ ordinary: [], pinned: [] }),
      prompt,
      close,
    });

    expect(prompt).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith([ordinary]);
  });
});
