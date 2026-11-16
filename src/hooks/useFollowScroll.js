import {useCallback, useEffect, useLayoutEffect, useRef, useState} from "react";
import {formatRelativeInstant} from "../ui/lib/format";

/** How close to the end, in pixels, the view still counts as at the end. */
const BOTTOM_SLACK = 24;
/** How long the age stays by the scroll handle once the scrolling stops. */
const AGE_SHOWN_MS = 1200;
/** The height of the age label, in pixels, kept within the view. */
const AGE_HEIGHT = 22;

/**
 * A stream read as a terminal, the newest at the end of `containerRef`: followed
 * while the view is at the end; scrolled up, the view stays on the line it shows at
 * its top as `items` change, the new lines counted (`countNew`) for a button back to
 * the end. While scrolled up, the age of the line in the middle of the view, by the
 * scroll handle. The lines are the elements matching `lineSelector`, each with an
 * `id` and its time in `data-at` (milliseconds). `items` null, nothing followed.
 *
 * The lines come in sight: each line new since the first ones shown is marked
 * `data-fresh`, a tint fading out (index.css), wherever it lands: one a stream merged
 * by time places above lines shown before it, as one of a node come late, too.
 */
export function useFollowScroll({containerRef, items, lineSelector, locale}) {
    const [following, setFollowing] = useState(true);
    const followingRef = useRef(true);
    const [newCount, setNewCount] = useState(0);
    const anchorRef = useRef(null);
    // The ids of the lines shown, null before the first ones.
    const seenRef = useRef(null);
    const [scrollAge, setScrollAge] = useState(null);
    const ageTimerRef = useRef(null);

    const follow = useCallback((on) => {
        followingRef.current = on;
        setFollowing(on);
        if (on) setNewCount(0);
    }, []);

    /** Lines come while scrolled up: counted, for the button back to the end. */
    const countNew = useCallback((count) => {
        if (!followingRef.current && count > 0) setNewCount((n) => n + count);
    }, []);

    const resetNew = useCallback(() => setNewCount(0), []);

    // Following, the view at the end; not, on the line it showed at its top, where it was.
    useLayoutEffect(() => {
        const container = containerRef.current;
        // Not a stream (`items` null): its view left alone.
        if (!container || items === null) return;
        // The lines new since those first shown, marked.
        const lines = [...container.querySelectorAll(lineSelector)];
        if (seenRef.current === null) {
            if (lines.length > 0) seenRef.current = new Set(lines.map((line) => line.id));
        } else {
            for (const line of lines) if (!seenRef.current.has(line.id)) line.setAttribute("data-fresh", "");
            seenRef.current = new Set(lines.map((line) => line.id));
        }
        if (followingRef.current) {
            container.scrollTop = container.scrollHeight;
            return;
        }
        const anchor = anchorRef.current;
        const element = anchor && document.getElementById(anchor.id);
        if (element) container.scrollTop = element.offsetTop - anchor.offset;
    }, [containerRef, items, lineSelector]);

    // At the end, following; scrolled up, not, the line at the top of the view noted.
    const handleScroll = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;
        const {scrollTop, scrollHeight, clientHeight} = container;
        const atEnd = scrollHeight - scrollTop - clientHeight < BOTTOM_SLACK;
        if (atEnd !== followingRef.current) follow(atEnd);
        const lines = [...container.querySelectorAll(lineSelector)];
        const top = lines.find((line) => line.offsetTop + line.offsetHeight > scrollTop);
        anchorRef.current = top ? {id: top.id, offset: top.offsetTop - scrollTop} : null;
        // Scrolled up, the age of the line in the middle of the view, where the handle is.
        if (ageTimerRef.current) clearTimeout(ageTimerRef.current);
        const middle = scrollTop + clientHeight / 2;
        const line = lines.find((l) => l.offsetTop + l.offsetHeight > middle) ?? lines.at(-1);
        const at = Number(line?.dataset.at);
        if (atEnd || !Number.isFinite(at)) {
            setScrollAge(null);
            return;
        }
        const range = scrollHeight - clientHeight;
        const ratio = range > 0 ? scrollTop / range : 0;
        setScrollAge({
            text: formatRelativeInstant(at, locale),
            top: Math.round(ratio * Math.max(0, clientHeight - AGE_HEIGHT)),
        });
        ageTimerRef.current = setTimeout(() => setScrollAge(null), AGE_SHOWN_MS);
    }, [containerRef, follow, lineSelector, locale]);

    useEffect(() => () => {
        if (ageTimerRef.current) clearTimeout(ageTimerRef.current);
    }, []);

    /** Back to the end, the new lines followed again. */
    const toEnd = useCallback(() => {
        follow(true);
        const container = containerRef.current;
        if (container) container.scrollTop = container.scrollHeight;
    }, [containerRef, follow]);

    return {following, follow, newCount, countNew, resetNew, handleScroll, toEnd, scrollAge};
}
