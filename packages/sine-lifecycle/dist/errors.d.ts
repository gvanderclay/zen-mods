export type ErrorReporter = (error: unknown) => unknown;
export declare const safeReporter: (report?: ErrorReporter) => (error: unknown) => void;
export declare const synchronousDisposer: (disposer: () => unknown, report: (error: unknown) => void) => () => void;
