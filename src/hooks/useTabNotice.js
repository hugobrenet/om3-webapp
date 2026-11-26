import {useCallback, useEffect, useMemo, useRef} from 'react';

/**
 * The title of the tab tells what the assistant did while the tab was hidden:
 * the user went to another tab or window during a long analysis. The
 * provider, which knows when a turn of the scope shown ends, tells it
 * (`tell`): `ended`, `failed`, or `waiting` for the decision of the user; the
 * words, ai.notice.tab.<kind>, go before the title, one notice at a time.
 * Nothing is told while the tab is shown: the menu and the dock tell it then.
 *
 * The title is given back once the tab is shown again, or by `clear` once
 * what it told is over: a turn runs again, the action no longer waits
 * (`clear("waiting")`), another identity or cluster. A title the page set
 * meanwhile stays.
 */
export default function useTabNotice(t) {
    const words = useRef(t);
    words.current = t;
    // The title the notice replaced, the one it set as the browser reads it
    // back, and what it tells.
    const shown = useRef(null);

    const giveBack = useCallback(() => {
        if (shown.current === null) return;
        if (document.title === shown.current.title) document.title = shown.current.base;
        shown.current = null;
    }, []);

    const tell = useCallback((kind) => {
        if (document.visibilityState !== 'hidden') return;
        const base = shown.current !== null && document.title === shown.current.title ? shown.current.base : document.title;
        document.title = `${words.current(`ai.notice.tab.${kind}`)} · ${base}`;
        shown.current = {base, title: document.title, kind};
    }, []);

    const clear = useCallback(
        (kind) => {
            if (shown.current === null || (kind !== undefined && shown.current.kind !== kind)) return;
            giveBack();
        },
        [giveBack]
    );

    useEffect(() => {
        const onVisibility = () => {
            if (document.visibilityState === 'visible') giveBack();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            giveBack();
        };
    }, [giveBack]);

    return useMemo(() => ({tell, clear}), [tell, clear]);
}
