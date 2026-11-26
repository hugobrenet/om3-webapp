import {useCallback, useEffect, useId, useRef, useState} from "react";
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

/** Where the user moved the open dock: its distance to the right of the window, in pixels. */
const DOCK_RIGHT_KEY = "om3.ai.dock.right";
/** The margin of the dock to the edges of the window, as `right-4`. */
const DOCK_MARGIN = 16;
/** The width of the notice of the folded dock, as `w-[24rem]`. */
const NOTICE_WIDTH = 384;
/** A step of the arrows of the keyboard moving the dock. */
const DOCK_STEP = 32;

const readDockRight = () => {
    try {
        const value = Number(localStorage.getItem(DOCK_RIGHT_KEY));
        return Number.isFinite(value) && value > DOCK_MARGIN ? value : null;
    } catch {
        return null;
    }
};

const storeDockRight = (value) => {
    try {
        if (value === null) localStorage.removeItem(DOCK_RIGHT_KEY);
        else localStorage.setItem(DOCK_RIGHT_KEY, String(value));
    } catch {
        // Kept for this page only.
    }
};

/**
 * The open dock moved along the bottom of the window, to the left or back, not to
 * hide what the page shows there: by its handle, dragged, or with the arrows of
 * the keyboard, Home taking it back to the right. Remembered by the browser; held
 * within the window. On a narrow window the dock takes its width: it stays.
 */
function useDockPlace(panel) {
    const wide = useMediaQuery(BREAKPOINTS.sm);
    const [right, setRight] = useState(readDockRight);
    const clamp = useCallback((value) => {
        const width = panel.current?.offsetWidth ?? 0;
        return Math.max(DOCK_MARGIN, Math.min(value, window.innerWidth - width - DOCK_MARGIN));
    }, [panel]);
    const place = useCallback((value) => {
        const next = value === null ? null : clamp(value);
        const kept = next !== null && next > DOCK_MARGIN ? next : null;
        setRight(kept);
        storeDockRight(kept);
    }, [clamp]);
    // A window made narrower keeps the dock in it.
    useEffect(() => {
        const keep = () => setRight((current) => (current === null ? null : clamp(current)));
        keep();
        window.addEventListener("resize", keep);
        return () => window.removeEventListener("resize", keep);
    }, [clamp]);

    const onPointerDown = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const handle = event.currentTarget;
        const startX = event.clientX;
        const start = right ?? DOCK_MARGIN;
        const at = (clientX) => start - (clientX - startX);
        handle.setPointerCapture?.(event.pointerId);
        const move = (next) => setRight(clamp(at(next.clientX)));
        const end = (last) => {
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", end);
            handle.removeEventListener("pointercancel", end);
            place(at(last.clientX));
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", end);
        handle.addEventListener("pointercancel", end);
    };
    const onKeyDown = (event) => {
        const from = right ?? DOCK_MARGIN;
        if (event.key === "ArrowLeft") place(from + DOCK_STEP);
        else if (event.key === "ArrowRight") place(from - DOCK_STEP);
        else if (event.key === "Home") place(null);
        else return;
        event.preventDefault();
    };
    return {movable: wide, style: wide && right !== null ? {right} : undefined, onPointerDown, onKeyDown};
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
    // Where the dock was moved, kept within a window narrower since.
    const right = readDockRight();
    const kept = wide && right !== null ? Math.min(right, window.innerWidth - NOTICE_WIDTH - DOCK_MARGIN) : null;
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
                    style={kept !== null && kept > DOCK_MARGIN ? {right: kept} : undefined}
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
    const heading = useRef(null);
    const log = useRef(null);
    const composer = useRef(null);
    const panel = useRef(null);
    const placement = useDockPlace(panel);
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
            aria-labelledby={titleId}
            onKeyDown={onKeyDown}
            style={placement.style}
            className="fixed right-4 bottom-4 z-(--z-dock) flex h-[min(36rem,calc(100dvh-6rem))] w-[26rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-(--radius-panel) border border-line bg-surface-raised shadow-xl max-sm:right-2 max-sm:left-2 max-sm:w-auto max-sm:max-w-none"
        >
            <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
                {placement.movable && (
                    <button
                        type="button"
                        aria-label={t("ai.dock.move")}
                        title={t("ai.dock.move")}
                        onPointerDown={placement.onPointerDown}
                        onKeyDown={placement.onKeyDown}
                        className={cn(ICON_BUTTON, "-ml-1 w-5 cursor-grab touch-none active:cursor-grabbing")}
                    >
                        <GripIcon width={14} height={14}/>
                    </button>
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
