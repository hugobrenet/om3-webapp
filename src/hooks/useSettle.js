import {useCallback, useEffect, useRef} from "react";

/** A record written or deleted: the list read again until it says so, the daemons applying the configuration. */
export const SETTLE_TRIES = 10;
export const SETTLE_EVERY_MS = 1000;

/**
 * What reads a list again until `settled` says it holds what was written, or no
 * longer what was deleted: `settle(read, settled)`, true once it does. The view
 * left, it stops there, read no more and false: what follows a settle, a panel
 * opened by the URL, done on the view left for, not on the page now shown.
 */
export function useSettle() {
    const live = useRef(true);
    const waits = useRef(new Set());
    useEffect(() => {
        live.current = true;
        const pending = waits.current;
        return () => {
            live.current = false;
            pending.forEach((wake) => wake());
            pending.clear();
        };
    }, []);
    return useCallback(async (read, settled) => {
        for (let i = 0; i < SETTLE_TRIES; i += 1) {
            if (!live.current) return false;
            const items = await read();
            if (!live.current) return false;
            if (settled(items)) return true;
            await new Promise((resolve) => {
                const wake = () => {
                    clearTimeout(timer);
                    waits.current.delete(wake);
                    resolve();
                };
                const timer = setTimeout(wake, SETTLE_EVERY_MS);
                waits.current.add(wake);
            });
        }
        return false;
    }, []);
}
