export type SineWindowStopReason = "sine-unload" | "window-unload";
export type SineWindowGenerationStopReason = SineWindowStopReason | "manual" | "replacement" | "startup-failure";
export interface SineWindowTarget {
    addUnloadListener?(callback: () => unknown): void;
    addEventListener(type: "unload", callback: () => void, options: {
        capture: false;
        once: true;
    }): void;
    removeEventListener(type: "unload", callback: () => void, options: {
        capture: false;
    }): void;
}
export interface SineWindowLifecycleOwner {
    defer(disposer: () => unknown): void;
    stop(reason: SineWindowStopReason): unknown;
}
export interface SineWindowGenerationState extends SineWindowLifecycleOwner {
    readonly stopReason: SineWindowGenerationStopReason | null;
    isLive(): boolean;
    stop(reason?: SineWindowGenerationStopReason): boolean;
}
export interface SineWindowLifecycleBinding {
    readonly sineUnload: "registered" | "unavailable";
}
/** Binds Sine hot unload and native window destruction to one terminal owner. */
export declare const bindSineWindowLifecycle: (target: SineWindowTarget, owner: SineWindowLifecycleOwner) => SineWindowLifecycleBinding;
