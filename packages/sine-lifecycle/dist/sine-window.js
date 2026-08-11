/** Binds Sine hot unload and native window destruction to one terminal owner. */
export const bindSineWindowLifecycle = (target, owner) => {
    const stopForSine = () => owner.stop("sine-unload");
    const stopForWindow = () => owner.stop("window-unload");
    owner.defer(() => {
        target.removeEventListener("unload", stopForWindow, { capture: false });
    });
    target.addEventListener("unload", stopForWindow, { capture: false, once: true });
    const sineUnload = typeof target.addUnloadListener === "function" ? "registered" : "unavailable";
    if (sineUnload === "registered") {
        target.addUnloadListener?.(stopForSine);
    }
    return { sineUnload };
};
