import { safeReporter, synchronousDisposer } from "./errors.js";
/** Owns synchronous resources until one terminal, failure-isolated LIFO drain. */
export class DisposableScope {
    #disposers;
    #report;
    #live = true;
    constructor({ onDisposeError } = {}) {
        if (typeof DisposableStack !== "function") {
            throw new Error("@zen-mods/sine-lifecycle requires DisposableStack");
        }
        this.#disposers = new DisposableStack();
        this.#report = safeReporter(onDisposeError);
    }
    isLive() {
        return this.#live;
    }
    defer(disposer) {
        const synchronous = synchronousDisposer(disposer, this.#report);
        if (this.#live) {
            this.#disposers.defer(synchronous);
            return;
        }
        try {
            synchronous();
        }
        catch (error) {
            this.#report(error);
        }
    }
    stop() {
        if (!this.#live) {
            return false;
        }
        this.#live = false;
        try {
            this.#disposers.dispose();
        }
        catch (error) {
            this.#report(error);
        }
        return true;
    }
}
