import {useEffect, useId, useRef, useState} from "react";
import {useLocation, useNavigate} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {activityState, useAiActivity, useAiDock, useSharedAiChat} from "../context/AiChatContext.js";
import useAiAvailable from "../hooks/useAiAvailable.js";
import useStickToBottom from "../hooks/useStickToBottom.js";
import AiComposer from "./AiComposer.jsx";
import AiMessages from "./AiMessages.jsx";
import {Alert} from "../ui/components/Alert";
import {Button} from "../ui/components/Button";
import {ChevronDownIcon, ExternalLinkIcon, PlusIcon, SparklesIcon} from "../ui/icons";
import {cn} from "../ui/cn";
import {untrustedT} from "../utils/untrustedText";

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
 * Folded, it is a button at the bottom right of every page, a quick way to ask
 * without going to the page of the assistant, which tells what the assistant
 * does meanwhile, as the menu does. Hidden on the page of the assistant, which
 * shows the chat already, and to a user who cannot use the assistant now.
 * `status`, the state of the cluster, which names the objects the answers link.
 */
export default function AiDock({status}) {
    const dock = useAiDock();
    const shared = useSharedAiChat();
    const available = useAiAvailable();
    const onPage = useLocation().pathname === "/ai";
    // The element the focus goes to once the dock is folded: the one that opened
    // it, else the button of the folded dock.
    const refocus = useRef(null);
    const button = useRef(null);
    useEffect(() => {
        if (dock?.state !== "folded" || refocus.current === null) return;
        const target = refocus.current === "button" ? button.current : refocus.current;
        refocus.current = null;
        target?.focus();
    }, [dock?.state]);

    // Opened on the page of the assistant, by a link of a panel over it: the page
    // shows the question, the dock stays folded for the other pages.
    const fold = dock?.fold;
    useEffect(() => {
        if (onPage && dock?.state === "open") fold();
    }, [onPage, dock?.state, fold]);

    if (dock === null || shared === null || onPage || !available) return null;
    if (dock.state === "folded") return <FoldedDock dock={dock} buttonRef={button}/>;
    return (
        <DockPanel
            dock={dock}
            status={status}
            onFold={() => {
                refocus.current = dock.origin() ?? "button";
                dock.fold();
            }}
        />
    );
}

/** The folded dock: a button, with what the assistant does meanwhile. */
function FoldedDock({dock, buttonRef}) {
    const {t} = useTranslation();
    const state = activityState(useAiActivity());
    const label = state === null ? t("ai.dock.open") : `${t("ai.dock.open")} · ${t(`ai.activity.${state}`)}`;
    return (
        <button
            ref={buttonRef}
            type="button"
            aria-label={label}
            title={label}
            onClick={dock.open}
            className="fixed right-4 bottom-4 z-(--z-dock) flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface-raised text-accent shadow-lg hover:bg-surface-sunken"
        >
            <SparklesIcon width={20} height={20}/>
            {state !== null && (
                <span
                    aria-hidden="true"
                    data-testid="dock-activity"
                    className={cn(
                        "absolute top-1 right-1 h-2.5 w-2.5 rounded-full",
                        state === "waiting" ? "bg-state-warn" : state === "answering" ? "animate-pulse bg-accent" : "bg-accent"
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

    const title = chat.conversation?.title || t("ai.title");
    const loading = !shared.ready || !chat.historyReady || chat.pending === "resuming";

    return (
        <aside
            aria-labelledby={titleId}
            onKeyDown={onKeyDown}
            className="fixed right-4 bottom-4 z-(--z-dock) flex h-[min(36rem,calc(100dvh-6rem))] w-[26rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-(--radius-panel) border border-line bg-surface-raised shadow-xl max-sm:right-2 max-sm:left-2 max-sm:w-auto max-sm:max-w-none"
        >
            <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
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
