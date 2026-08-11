import { type ErrorReporter } from "./errors.js";
export interface DisposableScopeOptions {
    onDisposeError?: ErrorReporter;
}
/** Owns synchronous resources until one terminal, failure-isolated LIFO drain. */
export declare class DisposableScope {
    #private;
    constructor({ onDisposeError }?: DisposableScopeOptions);
    isLive(): boolean;
    defer(disposer: () => unknown): void;
    stop(): boolean;
}
