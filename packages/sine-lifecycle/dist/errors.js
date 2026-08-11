const isThenable = (value) => (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function";
export const safeReporter = (report = () => { }) => (error) => {
    try {
        const result = report(error);
        if (isThenable(result)) {
            void Promise.resolve(result).catch(() => { });
        }
    }
    catch {
        // Reporting cannot interrupt the cleanup it describes.
    }
};
export const synchronousDisposer = (disposer, report) => () => {
    const result = disposer();
    if (!isThenable(result)) {
        return;
    }
    void Promise.resolve(result).catch(report);
    throw new TypeError("lifecycle disposers must finish synchronously");
};
