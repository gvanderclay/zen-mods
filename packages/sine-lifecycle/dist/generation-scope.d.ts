import { type ErrorReporter } from "./errors.js";
export interface TimerPort {
    setTimeout(callback: () => void, delayMs: number): number;
    clearTimeout(handle: number): void;
}
export type WaitResult<T> = {
    kind: "ready";
    value: T;
} | {
    kind: "stopped";
};
export interface GenerationScopeOptions {
    timers: TimerPort;
    onDisposeError?: ErrorReporter;
}
/** Owns resources and asynchronous continuations for one terminal generation. */
export declare class GenerationScope {
    #private;
    constructor({ timers, onDisposeError }: GenerationScopeOptions);
    get signal(): AbortSignal;
    isLive(): boolean;
    get pendingTimers(): number;
    get pendingWaits(): number;
    defer(disposer: () => unknown): void;
    wait<T>(work: PromiseLike<T> | T): Promise<WaitResult<T>>;
    sleep(delayMs: number): Promise<"elapsed" | "stopped">;
    schedule(delayMs: number, callback: () => void): () => void;
    stop(): boolean;
}
