export type ErrorReporter = (error: unknown) => unknown;

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  "then" in value &&
  typeof value.then === "function";

export const safeReporter =
  (report: ErrorReporter = () => {}) =>
  (error: unknown) => {
    try {
      const result = report(error);
      if (isThenable(result)) {
        void Promise.resolve(result).catch(() => {});
      }
    } catch {
      // Reporting cannot interrupt the cleanup it describes.
    }
  };

export const synchronousDisposer =
  (disposer: () => unknown, report: (error: unknown) => void) => () => {
    const result = disposer();
    if (!isThenable(result)) {
      return;
    }
    void Promise.resolve(result).catch(report);
    throw new TypeError("lifecycle disposers must finish synchronously");
  };
