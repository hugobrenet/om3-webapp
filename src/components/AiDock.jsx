import {useCallback, useEffect, useId, useRef, useState, useSyncExternalStore} from "react";
import {useLocation, useNavigate} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {activityState, useAiActivity, useAiDock, useSharedAiChat} from "../context/AiChatContext.js";
import useAiAvailable, {useAiOffered} from "../hooks/useAiAvailable.js";
import useStickToBottom from "../hooks/useStickToBottom.js";
import AiComposer from "./AiComposer.jsx";
import AiMessages from "./AiMessages.jsx";
import {Alert} from "../ui/components/Alert";
import {Button} from "../ui/components/Button";
import {ChevronDownIcon, CloseIcon, ExternalLinkIcon, GripIcon, PlusIcon, SparklesIcon} from "../ui/icons";
import {BREAKPOINTS, useMediaQuery} from "../ui/lib/media";
import {typing, useShortcut} from "../ui/lib/shortcuts";
import {cn} from "../ui/cn";
import {untrustedT} from "../utils/untrustedText";

/**
 * Where the user moved the open dock along the bottom of the window and the size they
 * gave it: its distance to the right of the window, its width and its height, in
 * pixels, null where it keeps its own. What the user chose, kept as it is: a smaller
 * window holds the dock within it for as long, and gives it back after.
 */
const DOCK_GEOMETRY_KEY = "om3.ai.dock.geometry";
/** Where an older version kept the dock moved along the bottom: its distance to the right. */
const DOCK_RIGHT_KEY = "om3.ai.dock.right";
/** The margin of the dock to the edges of the window, as `right-4` and `bottom-4`. */
const DOCK_MARGIN = 16;
/** What the dock leaves above it, the top bar, as its height `calc(100dvh-6rem)` does. */
const DOCK_TOP = 80;
/** Its own width, `w-[26rem]`, and height, `h-[min(36rem,…)]`, in rem: they follow the font. */
const DOCK_WIDTH_REM = 26;
const DOCK_HEIGHT_REM = 36;
/** The smallest it is made. */
const DOCK_MIN_WIDTH = 320;
const DOCK_MIN_HEIGHT = 320;
/** Closer to an edge of the window than this, moved, it goes against it. */
const DOCK_SNAP = 24;
/** Less than this, a pointer pressed and released is a click: nothing moves. */
const DOCK_DRAG_THRESHOLD = 4;
/** The width of the notice of the folded dock, as `w-[24rem]`. */
const NOTICE_WIDTH = 384;
/** A step of the arrows of the keyboard moving the dock, or sizing it. */
const DOCK_STEP = 32;

const NO_GEOMETRY = {right: null, width: null, height: null};

const length = (value) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);

/** The geometry the browser keeps, that of an older version read as it. */
function readDockGeometry() {
    try {
        const kept = JSON.parse(localStorage.getItem(DOCK_GEOMETRY_KEY) ?? "null");
        if (kept && typeof kept === "object" && !Array.isArray(kept)) {
            return {right: length(kept.right), width: length(kept.width), height: length(kept.height)};
        }
        const right = Number(localStorage.getItem(DOCK_RIGHT_KEY));
        return {...NO_GEOMETRY, right: Number.isFinite(right) && right > DOCK_MARGIN ? right : null};
    } catch {
        return NO_GEOMETRY;
    }
}

function storeDockGeometry(geometry) {
    try {
        localStorage.removeItem(DOCK_RIGHT_KEY);
        if (Object.values(geometry).every((value) => value === null)) localStorage.removeItem(DOCK_GEOMETRY_KEY);
        else localStorage.setItem(DOCK_GEOMETRY_KEY, JSON.stringify(geometry));
    } catch {
        // Kept for this page only.
    }
}

/** The size of a rem, as the browser sets the font. */
function remPixels() {
    const size = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return Number.isFinite(size) && size > 0 ? size : 16;
}

/** The size the dock takes of its own in a window `height` high. */
function ownSize(height) {
    const rem = remPixels();
    return {width: DOCK_WIDTH_REM * rem, height: Math.min(DOCK_HEIGHT_REM * rem, height - DOCK_TOP - DOCK_MARGIN)};
}

/** The size of the window, a snapshot of its own: the dock follows it. */
const subscribeWindow = (onChange) => {
    window.addEventListener("resize", onChange);
    return () => window.removeEventListener("resize", onChange);
};
const windowSize = () => `${window.innerWidth}x${window.innerHeight}`;

/**
 * Where the dock shows in a window of `width` by `height`: what the user chose, held
 * within the window, its own values for those they did not choose.
 */
function shownGeometry(geometry, width, height) {
    const own = ownSize(height);
    const shownWidth = Math.min(Math.max(DOCK_MIN_WIDTH, width - 2 * DOCK_MARGIN), Math.max(DOCK_MIN_WIDTH, geometry.width ?? own.width));
    const shownHeight = Math.min(Math.max(DOCK_MIN_HEIGHT, height - DOCK_TOP - DOCK_MARGIN), Math.max(DOCK_MIN_HEIGHT, geometry.height ?? own.height));
    return {
        right: Math.max(DOCK_MARGIN, Math.min(geometry.right ?? DOCK_MARGIN, width - shownWidth - DOCK_MARGIN)),
        width: shownWidth,
        height: shownHeight,
    };
}

/** What the user chose from where the dock is put: its own values null again. */
function chosenGeometry(shown) {
    const own = ownSize(window.innerHeight);
    return {
        right: shown.right > DOCK_MARGIN ? shown.right : null,
        width: Math.abs(shown.width - own.width) < 1 ? null : shown.width,
        height: Math.abs(shown.height - own.height) < 1 ? null : shown.height,
    };
}

/** A distance moved close to an edge of the window, against it. */
function snap(value, far) {
    if (value - DOCK_MARGIN < DOCK_SNAP) return DOCK_MARGIN;
    if (far - value < DOCK_SNAP) return far;
    return value;
}

/**
 * The open dock moved along the bottom of the window and sized, not to hide what the
 * page shows there: moved by its title bar or its handle, dragged, against an edge of
 * the window once close to it; sized by its left and top edges and their corner, its
 * bottom right staying; with the keyboard on its handle, Left and Right moving it, with
 * Shift the arrows sizing it, Home putting it back. Its title bar double clicked puts
 * it back too. Remembered by the browser; held within the window. On a narrow window
 * the dock takes its width: it stays.
 */
function useDockGeometry() {
    const wide = useMediaQuery(BREAKPOINTS.sm);
    const [chosen, setChosen] = useState(readDockGeometry);
    // Where it is while dragged, put once the pointer is released.
    const [dragged, setDragged] = useState(null);
    const drag = useRef(null);
    const [innerWidth, innerHeight] = useSyncExternalStore(subscribeWindow, windowSize, () => "0x0").split("x").map(Number);
    const shown = dragged ?? shownGeometry(chosen, innerWidth, innerHeight);

    const place = useCallback((next) => {
        setChosen(next);
        storeDockGeometry(next);
    }, []);
    // An older version's place, read: kept under the key of this one.
    useEffect(() => {
        try {
            if (localStorage.getItem(DOCK_RIGHT_KEY) !== null) storeDockGeometry(chosen);
        } catch {
            // Read again next time.
        }
        // On opening only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /** What a drag of `kind` from `start` gives, the pointer moved by dx, dy. */
    const follow = (kind, start, dx, dy) => {
        if (kind === "move") {
            const far = innerWidth - start.width - DOCK_MARGIN;
            return {...start, right: Math.max(DOCK_MARGIN, Math.min(snap(start.right - dx, far), far))};
        }
        // Sized, the bottom right stays: no larger than the window leaves on its side.
        const width = kind.includes("left") ? Math.min(innerWidth - start.right - DOCK_MARGIN, Math.max(DOCK_MIN_WIDTH, start.width - dx)) : start.width;
        const height = kind.includes("top") ? Math.min(innerHeight - DOCK_MARGIN - DOCK_TOP, Math.max(DOCK_MIN_HEIGHT, start.height - dy)) : start.height;
        return {...start, width, height};
    };

    /** The handlers of an element dragged as `kind`: the title bar moving, an edge sizing. */
    const dragHandlers = (kind) => ({
        onPointerDown: (event) => {
            if (event.button !== 0 || drag.current !== null) return;
            const target = event.target instanceof Element ? event.target : null;
            if (kind === "move" && target?.closest("button:not([data-dock-handle])")) return;
            // No text selected in the page under the pointer while dragging; the
            // handle pressed takes the focus all the same, for its arrows.
            event.preventDefault();
            target?.closest("[data-dock-handle]")?.focus({preventScroll: true});
            event.currentTarget.setPointerCapture?.(event.pointerId);
            drag.current = {kind, pointerId: event.pointerId, x: event.clientX, y: event.clientY, start: shown, moved: false};
        },
        onPointerMove: (event) => {
            const current = drag.current;
            if (current === null || event.pointerId !== current.pointerId) return;
            const dx = event.clientX - current.x;
            const dy = event.clientY - current.y;
            if (!current.moved && Math.abs(dx) < DOCK_DRAG_THRESHOLD && Math.abs(dy) < DOCK_DRAG_THRESHOLD) return;
            current.moved = true;
            setDragged(follow(current.kind, current.start, dx, dy));
        },
        onPointerUp: (event) => end(event),
        onPointerCancel: (event) => end(event),
        onLostPointerCapture: (event) => end(event),
    });
    /** The drag ends: put where it was dragged, a plain click changing nothing. */
    const end = (event) => {
        const current = drag.current;
        if (current === null || event.pointerId !== current.pointerId) return;
        drag.current = null;
        if (event.type !== "lostpointercapture") event.currentTarget.releasePointerCapture?.(event.pointerId);
        if (!current.moved) return;
        const dx = event.clientX - current.x;
        const dy = event.clientY - current.y;
        setDragged(null);
        // A capture lost carries no position: where it was last dragged.
        place(chosenGeometry(event.type === "lostpointercapture" ? dragged ?? current.start : follow(current.kind, current.start, dx, dy)));
    };

    const reset = () => place(NO_GEOMETRY);
    const onDoubleClick = (event) => {
        if (event.target instanceof Element && event.target.closest("button:not([data-dock-handle])")) return;
        reset();
    };
    const onKeyDown = (event) => {
        if (event.key === "Home") {
            reset();
            event.preventDefault();
            return;
        }
        const step = {ArrowLeft: [DOCK_STEP, 0], ArrowRight: [-DOCK_STEP, 0], ArrowUp: [0, DOCK_STEP], ArrowDown: [0, -DOCK_STEP]}[event.key];
        // Up and Down size it only: it moves along the bottom.
        if (!step || (!event.shiftKey && step[0] === 0)) return;
        const [x, y] = step;
        place(chosenGeometry(event.shiftKey ? follow(["left", "top"], shown, -x, -y) : follow("move", shown, -x, 0)));
        event.preventDefault();
    };

    let style;
    if (wide && dragged !== null) style = {right: shown.right, width: shown.width, height: shown.height};
    else if (wide) {
        // Its own values left to its classes: the height follows the window.
        style = Object.fromEntries(["right", "width", "height"].filter((key) => chosen[key] !== null).map((key) => [key, shown[key]]));
        if (Object.keys(style).length === 0) style = undefined;
    }
    return {
        movable: wide, dragging: dragged !== null, style,
        bar: {...dragHandlers("move"), onDoubleClick},
        edge: dragHandlers, onKeyDown,
    };
}

const ICON_BUTTON =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-(--radius-control) text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:opacity-60";

/**
 * The dock of the assistant: the chat over the page on display, asked about what
 * the page shows (`interface-context.ts`) without leaving it, or opened by
 * "Analyze with the assistant" on a failed action. It shows the
 * conversation of the page of the assistant, from the same chat (AiChatProvider):
 * "Open in the assistant page" goes to that page, the conversation and the
 * message typed kept.
 *
 * It opens from a small button of the top bar, beside the user (`AiDockButton`),
 * a quick way to ask without going to the page of the assistant, which tells
 * what the assistant does meanwhile, as the menu does. Hidden on the page of the
 * assistant, which shows the chat already, and to a user who cannot use the
 * assistant now.
 * `status`, the state of the cluster, which names the objects the answers link.
 */
export default function AiDock({status}) {
    const dock = useAiDock();
    const shared = useSharedAiChat();
    const available = useAiAvailable();
    const onPage = useLocation().pathname === "/ai";
    // The element the focus goes back to once the dock is folded: the link that
    // opened it. Opened by its button or its key, none: the focus leaves the dock
    // with it, the button of the top bar not ringed for a dock it did not open.
    const refocus = useRef(null);
    useEffect(() => {
        if (dock?.state !== "folded" || refocus.current === null) return;
        const target = refocus.current;
        refocus.current = null;
        target.focus();
    }, [dock?.state]);

    // Opened on the page of the assistant, by a link of a panel over it: the page
    // shows the question, the dock stays folded for the other pages.
    const fold = dock?.fold;
    useEffect(() => {
        if (onPage && dock?.state === "open") fold();
    }, [onPage, dock?.state, fold]);

    if (dock === null || shared === null || onPage || !available) return null;
    if (dock.state === "folded") return <ActivityNotice onOpen={dock.open}/>;
    return (
        <DockPanel
            dock={dock}
            status={status}
            onFold={() => {
                refocus.current = dock.origin();
                dock.fold();
            }}
        />
    );
}

/**
 * What the folded dock tells once a turn ended out of sight, or an action
 * began to wait there for the decision of the user (`activity.notice`): a
 * notice where the dock opens, moved with it, which opens it on the answer or
 * the action, or goes, closed by its button or Escape, the focus then on the
 * button of the dock. A view shows the chat, and it goes by itself; the menu
 * and the button of the dock still tell it until the chat is seen. It takes no
 * focus; its words are told by a region always there, to be announced.
 */
export function ActivityNotice({onOpen}) {
    const {t} = useTranslation();
    const notice = useAiActivity()?.notice ?? null;
    const wide = useMediaQuery(BREAKPOINTS.sm);
    // Where the dock opens, held within the window; narrow, at its own place.
    const geometry = readDockGeometry();
    const right = wide && geometry.right !== null
        ? Math.min(shownGeometry(geometry, window.innerWidth, window.innerHeight).right, window.innerWidth - NOTICE_WIDTH - DOCK_MARGIN)
        : null;
    // The notice the user closed: the next one shows.
    const [closed, setClosed] = useState(null);
    if (closed !== null && notice !== closed) setClosed(null);
    const shown = notice !== null && notice !== closed ? notice : null;
    const close = () => {
        setClosed(notice);
        document.querySelector("[data-ai-dock-button]")?.focus();
    };
    return (
        <>
            <p role="status" className="sr-only">
                {shown ? t(`ai.notice.${shown}`) : ""}
            </p>
            {shown && (
                <div
                    onKeyDown={(event) => {
                        if (event.key !== "Escape") return;
                        event.stopPropagation();
                        close();
                    }}
                    style={right !== null && right > DOCK_MARGIN ? {right} : undefined}
                    className={cn(
                        "fixed right-4 bottom-4 z-(--z-dock) flex w-[24rem] max-w-[calc(100vw-2rem)] items-start gap-2 rounded-(--radius-panel) border bg-surface-raised p-3 shadow-xl max-sm:right-2",
                        shown === "waiting" ? "border-state-warn" : shown === "failed" ? "border-state-down" : "border-line"
                    )}
                >
                    <SparklesIcon width={16} height={16} className="mt-0.5 shrink-0 text-accent"/>
                    <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
                        <p aria-hidden="true">{t(`ai.notice.${shown}`)}</p>
                        <Button size="sm" onClick={onOpen}>
                            {t(shown === "waiting" ? "ai.notice.seeAction" : "ai.notice.see")}
                        </Button>
                    </div>
                    <button
                        type="button"
                        aria-label={t("ai.notice.dismiss")}
                        title={t("ai.notice.dismiss")}
                        onClick={close}
                        className={ICON_BUTTON}
                    >
                        <CloseIcon width={14} height={14}/>
                    </button>
                </div>
            )}
        </>
    );
}

/**
 * The button of the dock in the top bar, beside the user: it opens the dock, or
 * folds it, and tells what the assistant does meanwhile. Shown as the entry of
 * the menu is, where the cluster names an agent, to an OpenID session; greyed
 * where the dock is not, its title saying why: on the page of the assistant, or
 * until the assistant can be used. The key "a" does what it does, as "p" for the
 * detail panel, while it can.
 */
export function AiDockButton() {
    const {t} = useTranslation();
    const dock = useAiDock();
    const shared = useSharedAiChat();
    const offered = useAiOffered();
    const available = useAiAvailable();
    const onPage = useLocation().pathname === "/ai";
    const state = activityState(useAiActivity());
    const usable = dock !== null && shared !== null && offered && available && !onPage;
    const open = usable && dock.state === "open";
    // Where the button cannot act, the key is left to the others.
    useShortcut("a", () => {
        if (!usable) return false;
        if (open) dock.fold();
        else dock.open();
        return true;
    });
    if (dock === null || shared === null || !offered) return null;
    const label = !usable
        ? t(onPage ? "ai.dock.onPage" : "ai.dock.unavailable")
        : state === null ? t("ai.dock.open") : `${t("ai.dock.open")} · ${t(`ai.activity.${state}`)}`;
    return (
        <button
            type="button"
            data-ai-dock-button=""
            aria-label={label}
            aria-expanded={open}
            title={label}
            disabled={!usable}
            onClick={open ? dock.fold : dock.open}
            className={cn(
                // In the ink of the top bar, whose accent is its background: greyed,
                // the logo stays, the button only fades.
                "relative flex h-7 w-7 shrink-0 items-center justify-center rounded-(--radius-control) border border-line text-ink",
                usable ? "hover:bg-surface-sunken" : "cursor-default opacity-70",
                open && "bg-surface-sunken"
            )}
        >
            <SparklesIcon width={16} height={16}/>
            {usable && state !== null && (
                <span
                    aria-hidden="true"
                    data-testid="dock-activity"
                    className={cn(
                        // Ringed in the colour of the bar, its accent there.
                        "absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full border-2 border-accent",
                        state === "waiting" ? "bg-state-warn" : state === "failed" ? "bg-state-down" : state === "answering" ? "animate-pulse bg-ink" : "bg-ink"
                    )}
                />
            )}
        </button>
    );
}

/** The open dock: the conversation, the action waiting, the message box. */
function DockPanel({dock, status, onFold}) {
    const {t} = useTranslation();
    const shared = useSharedAiChat();
    const {chat, attach} = shared;
    const navigate = useNavigate();
    const titleId = useId();
    const moveHelpId = useId();
    const heading = useRef(null);
    const log = useRef(null);
    const composer = useRef(null);
    const panel = useRef(null);
    const placement = useDockGeometry();
    // The dialog of the composer replacing the message queued tells the error.
    const [replacing, setReplacing] = useState(false);
    const busy = Boolean(chat.pending);
    const answering = chat.pending === "turn" || chat.pending === "confirming";

    // The dock on display: the chat is read, and the turns that end now are seen.
    useEffect(() => attach(), [attach]);

    // Opened, the focus goes into the dock, off the page under it. With a
    // question, the composer gives it to the message box once the question is in
    // it. Without one, the message box takes it when open, else the title of the
    // dock while the chat is read, then the box once it opens, unless the user
    // moved it. Open as the composer has it: no operation but a turn, the history
    // read, the chat ready.
    const boxOpen = shared.ready && chat.historyReady && (!busy || answering);
    const focusBox = useRef(false);
    useEffect(() => {
        if (shared.prompt !== null) return;
        if (boxOpen) {
            composer.current?.focus();
            return;
        }
        heading.current?.focus();
        focusBox.current = true;
        // On opening only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
        if (!focusBox.current || !boxOpen) return;
        focusBox.current = false;
        if (document.activeElement === heading.current) composer.current?.focus();
    }, [boxOpen]);

    // The latest message in sight while the user reads the end, not once they went up.
    const onLogScroll = useStickToBottom(log, {messages: chat.messages, conversationId: chat.conversation?.id ?? null});

    // To the page of the assistant: a move, not an end. The dock folds, and its
    // button is there again on the other pages.
    const expand = () => {
        navigate("/ai");
        dock.fold();
    };

    const onKeyDown = (event) => {
        if (event.key !== "Escape") return;
        // A panel under the dock listens for Escape too: it stays open.
        event.stopPropagation();
        onFold();
    };

    // Escape with the focus on the page folds the dock too, once nothing above it
    // takes the key: an open panel closes first, a modal dialog, a menu, a list or
    // a field keep it.
    const fold = useRef(onFold);
    fold.current = onFold;
    useEffect(() => {
        function onPageKeyDown(event) {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            const target = event.target instanceof Element ? event.target : null;
            if (panel.current?.contains(target) || typing(target)) return;
            if (target?.closest('[role="menu"], [role="listbox"], details[open]')) return;
            if (document.querySelector('[aria-modal="true"], [role="dialog"][aria-modal="false"]:not([inert])')) return;
            fold.current();
        }
        document.addEventListener("keydown", onPageKeyDown);
        return () => document.removeEventListener("keydown", onPageKeyDown);
    }, []);

    const title = chat.conversation?.title || t("ai.title");
    const loading = !shared.ready || !chat.historyReady || chat.pending === "resuming";

    return (
        <aside
            ref={panel}
            data-ai-dock=""
            aria-labelledby={titleId}
            onKeyDown={onKeyDown}
            style={placement.style}
            className={cn(
                "fixed right-4 bottom-4 z-(--z-dock) flex h-[min(36rem,calc(100dvh-6rem))] w-[26rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-(--radius-panel) border border-line bg-surface-raised shadow-xl max-sm:right-2 max-sm:left-2 max-sm:w-auto max-sm:max-w-none",
                placement.dragging && "select-none"
            )}
        >
            {/* Its left and top edges and their corner size it: the bottom right stays. */}
            {placement.movable && (
                <>
                    <div aria-hidden="true" data-dock-edge="left" {...placement.edge(["left"])}
                         className="absolute top-3.5 bottom-3.5 left-0 z-10 w-2 cursor-ew-resize touch-none"/>
                    <div aria-hidden="true" data-dock-edge="top" {...placement.edge(["top"])}
                         className="absolute top-0 right-3.5 left-3.5 z-10 h-1.5 cursor-ns-resize touch-none"/>
                    <div aria-hidden="true" data-dock-edge="corner" {...placement.edge(["left", "top"])}
                         className="absolute top-0 left-0 z-10 h-3.5 w-3.5 cursor-nwse-resize touch-none"/>
                </>
            )}
            <div
                {...(placement.movable ? placement.bar : {})}
                className={cn(
                    "flex items-center gap-1 border-b border-line px-2 py-1.5",
                    placement.movable && "cursor-grab touch-none pl-3.5",
                    placement.dragging && "cursor-grabbing"
                )}
            >
                {placement.movable && (
                    <>
                        <button
                            type="button"
                            data-dock-handle=""
                            aria-label={t("ai.dock.move")}
                            aria-describedby={moveHelpId}
                            title={t("ai.dock.moveHelp")}
                            onKeyDown={placement.onKeyDown}
                            className={cn(ICON_BUTTON, "w-5 cursor-grab active:cursor-grabbing")}
                        >
                            <GripIcon width={14} height={14}/>
                        </button>
                        <span id={moveHelpId} hidden>{t("ai.dock.moveHelp")}</span>
                    </>
                )}
                <SparklesIcon width={16} height={16} className="shrink-0 text-accent"/>
                <h2 id={titleId} ref={heading} tabIndex={-1} className="min-w-0 flex-1 truncate font-semibold outline-none">
                    {title}
                </h2>
                {/* A new conversation as the page opens on: none, the first message
                    sent creating it, nothing asked of the agent before. */}
                <button
                    type="button"
                    aria-label={t("ai.conversations.new")}
                    title={t("ai.conversations.new")}
                    disabled={busy || !chat.conversation}
                    onClick={chat.leaveConversation}
                    className={ICON_BUTTON}
                >
                    <PlusIcon width={14} height={14}/>
                </button>
                <button
                    type="button"
                    aria-label={t("ai.dock.expand")}
                    title={t("ai.dock.expand")}
                    onClick={expand}
                    className={ICON_BUTTON}
                >
                    <ExternalLinkIcon width={14} height={14}/>
                </button>
                <button
                    type="button"
                    aria-label={t("ai.dock.fold")}
                    title={t("ai.dock.fold")}
                    onClick={onFold}
                    className={ICON_BUTTON}
                >
                    <ChevronDownIcon width={14} height={14}/>
                </button>
            </div>

            <div
                ref={log}
                onScroll={onLogScroll}
                role="log"
                aria-label={t("ai.transcript.log")}
                aria-live="polite"
                aria-relevant="additions text"
                aria-busy={answering}
                className="relative min-h-0 flex-1 overflow-y-auto p-3"
            >
                {loading ? (
                    <p className="text-ink-muted">{t("ai.transcript.loadingSaved")}</p>
                ) : chat.messages.length === 0 ? (
                    <p className="text-ink-muted">{t("ai.dock.empty")}</p>
                ) : (
                    <AiMessages chat={chat} status={status}/>
                )}
            </div>

            {/* The action waiting, named only: approving it takes the card of the
                page, with its arguments, its preview and its changes. It may be
                rejected here. */}
            {chat.confirmation && (
                <div
                    role="group"
                    aria-label={t("ai.dock.waitingLabel")}
                    className="mx-2 mb-2 flex flex-col gap-2 rounded-(--radius-control) border border-state-warn bg-state-warn-soft p-2"
                >
                    <p>
                        {untrustedT(t, "ai.dock.waiting", {action: chat.confirmation.tool.title || chat.confirmation.tool.name})}
                        {chat.confirmation.tool.destructive && (
                            <span className="ml-1 font-medium text-state-down">{t("ai.dock.destructive")}</span>
                        )}
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={expand}>
                            {t("ai.dock.detail")}
                        </Button>
                        <Button size="sm" disabled={busy} onClick={() => void chat.reject()}>
                            {t("ai.confirm.reject")}
                        </Button>
                    </div>
                </div>
            )}
            {chat.error && !replacing && <Alert className="mx-2 mb-2">{chat.error}</Alert>}
            {chat.notice && <Alert tone="info" className="mx-2 mb-2">{chat.notice}</Alert>}
            <AiComposer inputRef={composer} compact onReplacingChange={setReplacing}/>
        </aside>
    );
}
