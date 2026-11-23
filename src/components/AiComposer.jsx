import {useEffect, useState} from "react";
import {useTranslation} from "react-i18next";
import {useSharedAiChat} from "../context/AiChatContext.js";
import {Alert} from "../ui/components/Alert";
import {Button} from "../ui/components/Button";
import {Dialog} from "../ui/components/Dialog";
import {Field, Textarea} from "../ui/components/Field";
import AiModelSelect from "./AiModelSelect.jsx";
import {ClockIcon, SendIcon, StopIcon} from "../ui/icons";
import {cn} from "../ui/cn";
import {untrustedT} from "../utils/untrustedText";

/** The largest message the agent takes, in bytes. */
export const MAX_PROMPT_BYTES = 32 * 1024;

/**
 * The message box of the assistant, the page's and the dock's, on the chat the
 * application holds (AiChatProvider): what the user types stays there from one
 * view to the other. Sent, a message starts a turn; while a turn runs or an
 * action waits, it is queued, one at most, replacing it asked first.
 *
 * A question a link asked (`prompt` of the provider) starts a new conversation
 * once the chat is read and nothing runs, the conversation shown left for none:
 * sent, asked by a click in the application, the agent creating the conversation
 * with its first turn; else put in the message box, never sent, as the question
 * of an address, the agent asked for nothing.
 *
 * `inputRef`, the message box; `compact`, the dock's, a line shorter;
 * `onReplacingChange`, told while the dialog replacing the queued message is
 * open, which says the error then.
 */
export default function AiComposer({inputRef, compact = false, onReplacingChange}) {
    const {t} = useTranslation();
    const shared = useSharedAiChat();
    if (shared === null) throw new Error("AiComposer needs an AiChatProvider");
    const {chat, ready, draft, setDraft} = shared;
    // The text the dialog would put in the queue, in place of the message queued.
    const [replacement, setReplacement] = useState(null);
    const busy = Boolean(chat.pending);
    const waiting = Boolean(chat.confirmation);
    // The message box stays open while a turn runs and while a confirmation
    // waits: what is sent then is queued. It closes for the short operations,
    // loading, resuming, creating, confirming, previewing.
    // A run resumed after an approval is the rest of its turn: the action
    // runs, then the model goes on, at times for long.
    const answering = chat.pending === "turn" || chat.pending === "confirming";
    const queueing = answering || (waiting && !busy);
    const composerClosed = !ready || !chat.historyReady || (busy && !answering);
    const promptTooLarge = new TextEncoder().encode(draft).length > MAX_PROMPT_BYTES;

    useEffect(() => {
        onReplacingChange?.(replacement !== null);
    }, [replacement, onReplacingChange]);


    // The message the dialog would replace went meanwhile: there is nothing
    // left to replace, and what the user typed stays in the box.
    useEffect(() => {
        if (replacement !== null && !chat.queued) setReplacement(null);
    }, [replacement, chat.queued]);

    // A question a link asked: on a new conversation, once the chat is read and
    // nothing runs, sent or in the box. Asked while a turn ran, or an action
    // waited, it was dropped by the provider, which says so. What the user typed
    // stays, the question sent.
    useEffect(() => {
        const prompt = shared.prompt;
        if (prompt === null || !ready) return;
        if (!chat.historyReady || busy || waiting) return;
        if (chat.conversation) {
            chat.leaveConversation();
            return;
        }
        shared.takePrompt();
        if (prompt.send) void chat.send(prompt.text);
        else setDraft(prompt.text);
        inputRef.current?.focus();
        // On the question, and what the chat does, only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shared.prompt, ready, chat.historyReady, chat.pending, chat.confirmation, chat.conversation]);

    const submit = (event) => {
        event.preventDefault();
        if (composerClosed || !draft.trim() || promptTooLarge) return;
        shared.clearPromptDropped();
        if (queueing) {
            // One message queued at most: replacing it is asked first.
            if (chat.queued) {
                setReplacement(draft);
                return;
            }
            if (chat.queue(draft)) setDraft("");
            inputRef.current?.focus();
            return;
        }
        const text = draft;
        setDraft("");
        void chat.send(text);
    };

    // After a stop or a failure, nothing goes alone: the user sends the queued
    // message again, or takes it back. Sent again, it goes with the page it
    // was asked from.
    const resend = () => {
        const context = chat.queued?.context;
        const model = chat.queued?.model;
        const text = chat.takeQueued();
        if (text) void chat.send(text, context, model);
    };

    const replace = () => {
        if (replacement !== null && chat.queue(replacement)) setDraft("");
        setReplacement(null);
        inputRef.current?.focus();
    };

    return (
        <>
            {shared.promptDropped && <Alert tone="info" className="mx-3 mb-2">{t("ai.promptDropped")}</Alert>}
            <form onSubmit={submit} className={cn("space-y-2 border-t border-line", compact ? "p-2" : "p-3")}>
                {/* Always there, so that the first message queued is announced too. */}
                <p aria-live="polite" className="sr-only">
                    {chat.queued ? untrustedT(t, "ai.queue.announce", {text: chat.queued.text}) : ""}
                </p>
                {chat.queued && (
                    <div
                        role="group"
                        aria-label={t("ai.queue.label")}
                        className="flex flex-wrap items-center gap-2 rounded-(--radius-control) border border-line bg-surface-sunken px-2 py-1 text-data"
                    >
                        <ClockIcon width={14} height={14} className="shrink-0 text-ink-muted"/>
                        <span className="text-ink-muted">{t("ai.queue.label")}</span>
                        {/* The text of the user, as typed. */}
                        <span className="min-w-0 flex-1 truncate">
                            {chat.queued.text}
                        </span>
                        {!queueing && !busy && (
                            <Button size="sm" disabled={!chat.historyReady} onClick={resend}>
                                {t("ai.queue.resend")}
                            </Button>
                        )}
                        <Button
                            size="sm"
                            // Never over what the user types.
                            disabled={Boolean(draft.trim())}
                            onClick={() => {
                                setDraft(chat.takeQueued() ?? "");
                                inputRef.current?.focus();
                            }}
                        >
                            {t("ai.queue.edit")}
                        </Button>
                        <Button size="sm" onClick={chat.unqueue}>
                            {t("ai.queue.remove")}
                        </Button>
                    </div>
                )}
                <Field
                    label={t("ai.composer.label")}
                    hint={
                        promptTooLarge
                            ? undefined
                            : waiting && !busy
                                ? t("ai.composer.queuedDuringConfirmation")
                                : answering
                                    ? t("ai.composer.queuedHint")
                                    : t("ai.composer.hint")
                    }
                    error={promptTooLarge ? t("ai.composer.tooLarge") : undefined}
                >
                    {(control) => (
                        <Textarea
                            {...control}
                            ref={inputRef}
                            rows={compact ? 2 : 3}
                            className={cn("resize-y", compact ? "max-h-32" : "max-h-48")}
                            value={draft}
                            disabled={composerClosed}
                            onChange={(event) => {
                                setDraft(event.target.value);
                                shared.clearPromptDropped();
                            }}
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
                <div className="flex flex-wrap items-center justify-end gap-2">
                    {chat.models && (
                        <div className="mr-auto min-w-0">
                            <AiModelSelect chat={chat} disabled={composerClosed}/>
                        </div>
                    )}
                    {/* A turn only: after an approval the action runs on the agent,
                        which a stop would not cancel; its result is what to see. */}
                    {chat.pending === "turn" && (
                        <Button icon={<StopIcon/>} onClick={chat.stop}>
                            {t("ai.composer.stop")}
                        </Button>
                    )}
                    <Button
                        type="submit"
                        variant="create"
                        icon={queueing ? <ClockIcon/> : <SendIcon/>}
                        disabled={composerClosed || !draft.trim() || promptTooLarge}
                    >
                        {queueing ? t("ai.composer.queue") : t("ai.composer.send")}
                    </Button>
                </div>
            </form>
            <Dialog
                open={replacement !== null}
                title={t("ai.dialog.replaceTitle")}
                onClose={() => setReplacement(null)}
                footer={
                    <>
                        <Button onClick={() => setReplacement(null)}>
                            {t("ai.dialog.cancel")}
                        </Button>
                        <Button variant="secondary" onClick={replace}>
                            {t("ai.dialog.replace")}
                        </Button>
                    </>
                }
            >
                <p>{t("ai.dialog.replaceText")}</p>
                {chat.error && <Alert>{chat.error}</Alert>}
            </Dialog>
        </>
    );
}
