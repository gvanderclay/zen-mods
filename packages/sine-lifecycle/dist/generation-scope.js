import { DisposableScope } from "./disposable-scope.js";
import { safeReporter } from "./errors.js";
/** Owns resources and asynchronous continuations for one terminal generation. */
export class GenerationScope {
    #abort = new AbortController();
    #cleanup;
    #report;
    #stopSubscribers = new Set();
    #timers;
    #timerCancels = new Set();
    #live = true;
    constructor({ timers, onDisposeError }) {
        this.#timers = timers;
        this.#report = safeReporter(onDisposeError);
        this.#cleanup = new DisposableScope({ onDisposeError: this.#report });
    }
    get signal() {
        return this.#abort.signal;
    }
    isLive() {
        return this.#live;
    }
    get pendingTimers() {
        return this.#timerCancels.size;
    }
    get pendingWaits() {
        return this.#stopSubscribers.size;
    }
    defer(disposer) {
        this.#cleanup.defer(disposer);
    }
    wait(work) {
        if (!this.#live) {
            void Promise.resolve(work).catch(this.#report);
            return Promise.resolve({ kind: "stopped" });
        }
        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (result) => {
                if (settled) {
                    return;
                }
                settled = true;
                this.#stopSubscribers.delete(onStop);
                resolve(result);
            };
            const onStop = () => finish({ kind: "stopped" });
            this.#stopSubscribers.add(onStop);
            void Promise.resolve(work).then(value => finish(this.#live ? { kind: "ready", value } : { kind: "stopped" }), error => {
                if (settled) {
                    return;
                }
                settled = true;
                this.#stopSubscribers.delete(onStop);
                reject(error);
            });
        });
    }
    sleep(delayMs) {
        if (!this.#live) {
            return Promise.resolve("stopped");
        }
        return new Promise((resolve, reject) => {
            let settled = false;
            let cancel = () => { };
            const finish = (result) => {
                if (settled) {
                    return;
                }
                settled = true;
                this.#stopSubscribers.delete(onStop);
                try {
                    cancel();
                }
                catch (error) {
                    this.#report(error);
                }
                finally {
                    resolve(result);
                }
            };
            const onStop = () => finish("stopped");
            this.#stopSubscribers.add(onStop);
            try {
                cancel = this.schedule(delayMs, () => finish("elapsed"));
            }
            catch (error) {
                settled = true;
                this.#stopSubscribers.delete(onStop);
                reject(error);
            }
        });
    }
    schedule(delayMs, callback) {
        if (!this.#live) {
            return () => { };
        }
        let active = true;
        let handle = 0;
        const cancel = () => {
            if (!active) {
                return;
            }
            active = false;
            this.#timerCancels.delete(cancel);
            this.#timers.clearTimeout(handle);
        };
        handle = this.#timers.setTimeout(() => {
            if (!active) {
                return;
            }
            active = false;
            this.#timerCancels.delete(cancel);
            if (this.#live) {
                callback();
            }
        }, delayMs);
        this.#timerCancels.add(cancel);
        return cancel;
    }
    stop() {
        if (!this.#live) {
            return false;
        }
        this.#live = false;
        for (const settle of [...this.#stopSubscribers]) {
            try {
                settle();
            }
            catch (error) {
                this.#report(error);
            }
        }
        this.#stopSubscribers.clear();
        for (const cancel of [...this.#timerCancels]) {
            try {
                cancel();
            }
            catch (error) {
                this.#report(error);
            }
        }
        try {
            this.#abort.abort();
        }
        catch (error) {
            this.#report(error);
        }
        this.#cleanup.stop();
        return true;
    }
}
