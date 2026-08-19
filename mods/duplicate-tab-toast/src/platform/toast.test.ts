import { describe, expect, it, vi } from "vitest";
import {
  DUPLICATE_TOAST_ID,
  showDuplicateTabToast,
  type ToastContainer,
  type ToastElement,
} from "./toast.ts";

describe("showDuplicateTabToast", () => {
  it("uses Zen's toast manager and replaces only the owned toast label", async () => {
    const removed: string[] = [];
    const label = {
      textContent: null as string | null,
      removeAttribute: (name: string) => removed.push(name),
    };
    const children: ToastElement[] = [];
    const container: ToastContainer = { children };
    const manager = {
      showToast: vi.fn((messageId: string, options?: { readonly timeout?: number }) => {
        expect(options).toEqual({ timeout: 3000 });
        children.push({
          _messageId: messageId,
          querySelector: () => label,
        });
      }),
    };

    await showDuplicateTabToast(2, manager, container);

    expect(manager.showToast).toHaveBeenCalledWith(DUPLICATE_TOAST_ID, {
      timeout: 3000,
    });
    expect(removed).toEqual(["data-l10n-id", "data-l10n-args"]);
    expect(label.textContent).toBe("2 tabs duplicated!");
  });

  it("fails when Zen does not create the expected toast", async () => {
    await expect(
      showDuplicateTabToast(1, { showToast() {} }, { children: [] }),
    ).rejects.toThrow("Zen did not create the duplicate-tab toast");
  });
});
