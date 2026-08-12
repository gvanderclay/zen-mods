export const NATIVE_INDICATOR_OWNER_ATTRIBUTE = "data-zen-load-bar-owner";

export interface NativeIndicatorRoot {
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  setAttribute(name: string, value: string): void;
}

export interface NativeIndicatorDocument {
  readonly documentElement: NativeIndicatorRoot;
}

export interface NativeIndicatorHandoffOptions {
  readonly defer: (disposer: () => unknown) => void;
  readonly document: NativeIndicatorDocument;
  readonly token: string;
}

export const installNativeIndicatorHandoff = ({
  defer,
  document,
  token,
}: NativeIndicatorHandoffOptions): void => {
  if (token.length === 0) {
    throw new Error("Load Bar ownership token must not be empty");
  }
  const root = document.documentElement;
  if (root.getAttribute(NATIVE_INDICATOR_OWNER_ATTRIBUTE) !== null) {
    throw new Error("Zen loading indicator is already owned by another generation");
  }

  let owned = false;
  const release = () => {
    if (!owned) {
      return;
    }
    if (root.getAttribute(NATIVE_INDICATOR_OWNER_ATTRIBUTE) === token) {
      root.removeAttribute(NATIVE_INDICATOR_OWNER_ATTRIBUTE);
    }
    owned = false;
  };
  defer(release);

  // Zen 1.21.13b ZenProgressBar.sys.mjs:34-50 creates #zen-loading-progress-bar.
  owned = true;
  try {
    root.setAttribute(NATIVE_INDICATOR_OWNER_ATTRIBUTE, token);
  } catch (error) {
    try {
      release();
    } catch {}
    throw error;
  }
};
