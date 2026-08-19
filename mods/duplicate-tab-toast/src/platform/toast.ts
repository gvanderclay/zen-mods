import { duplicateToastText } from "../core/message.ts";

export const DUPLICATE_TOAST_ID = "zen-duplicate-tab-toast";

export interface ToastLabel {
  textContent: string | null;
  removeAttribute(name: string): void;
}

export interface ToastElement {
  readonly _messageId?: string;
  querySelector(selector: string): ToastLabel | null;
}

export interface ToastContainer {
  readonly children: Iterable<ToastElement>;
}

export interface ToastManager {
  showToast(
    messageId: string,
    options?: { readonly timeout?: number },
  ): void | Promise<void>;
}

export const showDuplicateTabToast = async (
  tabCount: number,
  manager: ToastManager,
  container: ToastContainer,
): Promise<void> => {
  // Zen 1.21.14b creates and appends the toast before its first animation await.
  const completion = manager.showToast(DUPLICATE_TOAST_ID, { timeout: 3000 });
  const toast = [...container.children].find(
    child => child._messageId === DUPLICATE_TOAST_ID,
  );
  const label = toast?.querySelector("label");
  if (!label) {
    await completion;
    throw new Error("Zen did not create the duplicate-tab toast");
  }
  label.removeAttribute("data-l10n-id");
  label.removeAttribute("data-l10n-args");
  label.textContent = duplicateToastText(tabCount);
  await completion;
};
