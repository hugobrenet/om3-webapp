import {useEffect, useRef, useState} from "react";
import {useAuth} from "../context/AuthProvider.jsx";
import useFetchDaemonStatus from "../hooks/useFetchDaemonStatus.jsx";
import useAiAgent from "../hooks/useAiAgent.js";
import useAiChat from "../hooks/useAiChat.js";
import AiMarkdown from "./AiMarkdown.jsx";
import {Alert} from "../ui/components/Alert";
import {Button} from "../ui/components/Button";
import {Dialog} from "../ui/components/Dialog";
import {Field, Input, Textarea} from "../ui/components/Field";
import {Spinner} from "../ui/components/Spinner";
import {ChatIcon, PencilIcon, PlusIcon, RefreshIcon, SendIcon, StopIcon, TrashIcon} from "../ui/icons";
import {cn} from "../ui/cn";

const PANEL = "flex min-w-0 flex-col rounded-(--radius-panel) border border-line bg-surface-raised";
const PANEL_HEADER = "flex flex-wrap items-center gap-2 border-b border-line px-3 py-2";

/** One message of the transcript: the text, the tool activity and the turn state. */
function Message({message}) {
    const user = message.role === "user";
    return (
        <li
            className={cn(
                "w-fit max-w-full rounded-(--radius-control) border border-line px-3 py-2",
                user ? "self-end bg-surface-sunken" : "self-start bg-surface"
            )}
        >
            <p className="mb-1 text-data font-semibold text-ink-muted">{user ? "You" : "Assistant"}</p>
            {message.text && !user && <AiMarkdown text={message.text}/>}
            {message.text && user && <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{message.text}</div>}
            {message.tools?.length > 0 && (
                <ul aria-label="Tool activity" className="my-1 list-disc pl-5 text-data">
                    {message.tools.map((tool) => (
                        <li key={tool.id} className={tool.status === "failed" ? "text-state-down" : "text-ink-muted"}>
                            {tool.name} — {tool.status}
                        </li>
                    ))}
                </ul>
            )}
            {message.status === "running" && <Spinner label="Working…" className="mt-1 text-data"/>}
            {["stopped", "failed"].includes(message.status) && (
                <p className="mt-1 text-data text-state-warn">
                    Incomplete response — {message.status}. No automatic retry.
                </p>
            )}
            {typeof message.usage?.total_tokens === "number" && (
                <p className="mt-1 text-data text-ink-muted">Tokens: {message.usage.total_tokens}</p>
            )}
        </li>
    );
}

const AiChat = () => {
    const auth = useAuth();
    const {clusterId, clusterName, loading, error: statusError, fetchNodes} = useFetchDaemonStatus();
    const {enabled, ready, configurationError, client} = useAiAgent({clusterId});
    // A conversation belongs to an identity on a cluster: changing either resets the view.
    const scope = JSON.stringify([auth.authChoice, auth.user, clusterId]);
    const chat = useAiChat({client, ready, scope});
    const [draft, setDraft] = useState("");
    const [dialog, setDialog] = useState("");
    const [title, setTitle] = useState("");
    const transcript = useRef(null);
    const scrollAnchor = useRef(null);
    const busy = Boolean(chat.pending);
    const turning = chat.pending === "turn";
    const promptTooLarge = new TextEncoder().encode(draft).length > 32 * 1024;

    useEffect(() => {
        if (enabled && auth.accessToken) void fetchNodes(auth.accessToken);
    }, [enabled, auth.authChoice, auth.accessToken, fetchNodes]);

    useEffect(() => {
        setDraft("");
        setDialog("");
        setTitle("");
    }, [scope, ready, chat.conversation?.id, chat.historyReady]);

    useEffect(() => {
        if (!transcript.current) return;
        const anchor = scrollAnchor.current;
        transcript.current.scrollTop =
            anchor && anchor.conversationId === chat.conversation?.id
                ? anchor.top + transcript.current.scrollHeight - anchor.height
                : transcript.current.scrollHeight;
        scrollAnchor.current = null;
    }, [chat.messages]);

    useEffect(() => {
        if (chat.pending !== "history") scrollAnchor.current = null;
    }, [chat.pending]);

    const loadOlder = () => {
        if (busy || !transcript.current) return;
        scrollAnchor.current = {
            conversationId: chat.conversation?.id,
            top: transcript.current.scrollTop,
            height: transcript.current.scrollHeight,
        };
        void chat.loadOlderMessages();
    };

    const submit = (event) => {
        event.preventDefault();
        if (!ready || !chat.historyReady || busy || !draft.trim() || promptTooLarge) return;
        const prompt = draft;
        setDraft("");
        void chat.send(prompt);
    };

    const confirmDialog = async () => {
        const result = dialog === "rename" ? await chat.renameConversation(title) : await chat.deleteConversation();
        if (result) setDialog("");
    };

    return (
        <div className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-3">
                <h1 className="flex items-center gap-2 text-title font-semibold">
                    <ChatIcon width={18} height={18} className="text-ink-muted"/>
                    AI Assistant
                </h1>
                {ready && (
                    <span className="rounded-full border border-line px-2 py-0.5 text-data text-ink-muted">
                        {clusterName || "Cluster"}
                    </span>
                )}
            </div>

            {!enabled && (
                <Alert tone="info">{configurationError || "The AI agent is not configured for this webapp."}</Alert>
            )}
            {enabled && !auth.accessToken && (
                <Alert tone="info">An authenticated session is required to use the AI assistant.</Alert>
            )}
            {enabled && auth.accessToken && !ready && (
                <Alert
                    tone={statusError ? "error" : "info"}
                    action={
                        <Button size="sm" disabled={loading} onClick={() => fetchNodes(auth.accessToken)}>
                            Refresh status
                        </Button>
                    }
                >
                    {statusError || (loading ? "Loading cluster information…" : "Waiting for the cluster ID.")}
                </Alert>
            )}

            {ready && (
                <div className="grid gap-3 md:grid-cols-[16rem_minmax(0,1fr)]">
                    <section aria-labelledby="ai-conversations" className={PANEL}>
                        <div className={PANEL_HEADER}>
                            <h2 id="ai-conversations" className="font-semibold">Conversations</h2>
                        </div>
                        <div className="space-y-2 p-3">
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    variant="primary"
                                    icon={<PlusIcon/>}
                                    disabled={busy}
                                    onClick={() => chat.createConversation()}
                                >
                                    New conversation
                                </Button>
                                <Button icon={<RefreshIcon/>} disabled={busy} onClick={() => chat.refreshConversations()}>
                                    Refresh conversations
                                </Button>
                            </div>
                            {chat.pending === "loading" && <Spinner label="Loading conversations"/>}
                            {!chat.conversations.length && !busy && (
                                <p className="text-ink-muted">No conversations yet.</p>
                            )}
                            <ul aria-label="Conversations" className="max-h-48 space-y-0.5 overflow-y-auto md:max-h-[55vh]">
                                {chat.conversations.map((conversation) => {
                                    const selected = conversation.id === chat.conversation?.id;
                                    return (
                                        <li key={conversation.id}>
                                            <button
                                                type="button"
                                                aria-current={selected ? "true" : undefined}
                                                disabled={busy}
                                                onClick={() => chat.resumeConversation(conversation.id)}
                                                className={cn(
                                                    "w-full rounded-(--radius-control) px-2 py-1 text-left [overflow-wrap:anywhere] disabled:opacity-60",
                                                    selected
                                                        ? "bg-surface-sunken font-medium text-ink"
                                                        : "text-ink-muted hover:bg-surface-sunken hover:text-ink"
                                                )}
                                            >
                                                {conversation.title || "Untitled conversation"}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    </section>

                    <section aria-labelledby="ai-transcript" className={PANEL}>
                        <div className={PANEL_HEADER}>
                            <h2 id="ai-transcript" className="min-w-0 font-semibold [overflow-wrap:anywhere]">
                                {chat.conversation?.title || "Ask about your cluster"}
                            </h2>
                            {chat.conversation && (
                                <div className="ml-auto flex gap-2">
                                    <Button
                                        size="sm"
                                        icon={<PencilIcon/>}
                                        disabled={busy}
                                        onClick={() => {
                                            setTitle(chat.conversation.title || "");
                                            setDialog("rename");
                                        }}
                                    >
                                        Rename
                                    </Button>
                                    <Button size="sm" icon={<TrashIcon/>} disabled={busy} onClick={() => setDialog("delete")}>
                                        Delete
                                    </Button>
                                </div>
                            )}
                        </div>
                        {chat.resumed && (
                            <Alert tone="info" className="mx-3 mt-3">
                                History shows completed exchanges only. Past tool activity and token usage are not
                                available.
                            </Alert>
                        )}
                        <div
                            ref={transcript}
                            role="log"
                            aria-label="Conversation messages"
                            aria-live="polite"
                            aria-relevant="additions text"
                            className="h-[45vh] min-h-60 overflow-y-auto p-3 md:h-[50vh]"
                        >
                            {chat.historyCursor && (
                                <Button size="sm" className="mb-3" disabled={busy} onClick={loadOlder}>
                                    {chat.pending === "history" ? "Loading earlier messages…" : "Load earlier messages"}
                                </Button>
                            )}
                            {!chat.messages.length && (
                                <p className="text-ink-muted">
                                    {chat.pending === "resuming"
                                        ? "Loading saved messages…"
                                        : !chat.historyReady
                                            ? "Select a conversation again or create a new one to continue."
                                            : "Send a prompt to start a conversation or continue the selected one."}
                                </p>
                            )}
                            <ul className="flex flex-col gap-3">
                                {chat.messages.map((message) => (
                                    <Message key={message.id} message={message}/>
                                ))}
                            </ul>
                        </div>
                        {chat.error && <Alert className="mx-3 mb-2">{chat.error}</Alert>}
                        {chat.notice && <Alert tone="info" className="mx-3 mb-2">{chat.notice}</Alert>}
                        <form onSubmit={submit} className="space-y-2 border-t border-line p-3">
                            <Field
                                label="Message"
                                hint={promptTooLarge ? undefined : "Enter to send; Shift+Enter for a new line. Uses your current cluster permissions."}
                                error={promptTooLarge ? "The prompt must not exceed 32 KiB." : undefined}
                            >
                                {(control) => (
                                    <Textarea
                                        {...control}
                                        rows={3}
                                        className="max-h-48 resize-y"
                                        value={draft}
                                        disabled={busy || !chat.historyReady}
                                        onChange={(event) => setDraft(event.target.value)}
                                        onKeyDown={(event) => {
                                            if (
                                                event.key !== "Enter" ||
                                                event.shiftKey ||
                                                event.nativeEvent.isComposing ||
                                                event.nativeEvent.keyCode === 229
                                            )
                                                return;
                                            event.preventDefault();
                                            submit(event);
                                        }}
                                    />
                                )}
                            </Field>
                            <div className="flex justify-end gap-2">
                                {turning && (
                                    <Button icon={<StopIcon/>} onClick={chat.stop}>
                                        Stop
                                    </Button>
                                )}
                                <Button
                                    type="submit"
                                    variant="primary"
                                    icon={<SendIcon/>}
                                    disabled={busy || !chat.historyReady || !draft.trim() || promptTooLarge}
                                >
                                    Send
                                </Button>
                            </div>
                        </form>
                    </section>
                </div>
            )}

            <Dialog
                open={ready && Boolean(dialog)}
                title={dialog === "rename" ? "Rename conversation" : "Delete conversation"}
                onClose={() => {
                    if (!busy) setDialog("");
                }}
                footer={
                    <>
                        <Button disabled={busy} onClick={() => setDialog("")}>
                            Cancel
                        </Button>
                        <Button
                            variant={dialog === "delete" ? "danger" : "primary"}
                            disabled={busy || (dialog === "rename" && !title.trim())}
                            onClick={confirmDialog}
                        >
                            {dialog === "rename" ? "Save title" : "Confirm deletion"}
                        </Button>
                    </>
                }
            >
                {dialog === "rename" ? (
                    <Field label="Conversation title" hint="Up to 80 Unicode characters.">
                        {(control) => (
                            <Input
                                {...control}
                                value={title}
                                disabled={busy}
                                onChange={(event) => setTitle(event.target.value)}
                            />
                        )}
                    </Field>
                ) : (
                    <p>Delete this conversation and its stored context? This cannot be undone.</p>
                )}
                {chat.error && <Alert>{chat.error}</Alert>}
            </Dialog>
        </div>
    );
};

export default AiChat;
