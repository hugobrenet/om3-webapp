import {useEffect, useId, useState} from "react";
import {useTranslation} from "react-i18next";
import {useSharedAiChat} from "../context/AiChatContext.js";
import {promptOf} from "../hooks/useAiChat.js";
import {Alert} from "../ui/components/Alert";
import {Button} from "../ui/components/Button";
import {Dialog} from "../ui/components/Dialog";
import {Field, Textarea} from "../ui/components/Field";
import AiModelSelect from "./AiModelSelect.jsx";
import {ClockIcon, CloseIcon, SendIcon, StopIcon} from "../ui/icons";
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
 * Where the agent serves skills (`chat.skills`), a `/` that starts the message box
 * lists them, filtered by what follows it: chosen with the arrows and Enter or
 * Tab, or a click, the skill is a tag over the box, the words typed after it the
 * message, and goes with it, the agent loading it first (forwardedProps.skill).
 * Sent without words, the message is the `/` and its name, as the conversation
 * shows it. Escape closes the list; a `/` elsewhere is text.
 *
 * `inputRef`, the message box; `compact`, the dock's, a line shorter;
 * `onReplacingChange`, told while the dialog replacing the queued message is
 * open, which says the error then.
 */
export default function AiComposer({inputRef, compact = false, onReplacingChange}) {
    const {t} = useTranslation();
    const shared = useSharedAiChat();
    if (shared === null) throw new Error("AiComposer needs an AiChatProvider");
    const {chat, ready, draft, setDraft, draftSkill, setDraftSkill} = shared;
    // The message the dialog would put in the queue, {text, skill}, in place of
    // the message queued.
    const [replacement, setReplacement] = useState(null);
    const listId = useId();
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
    // A skill named whole at the start of the box, `/name` then a space or
    // nothing, is that skill, the rest the words: as if it was chosen.
    const named = (text) => {
        const match = !draftSkill && chat.skills ? /^\/([a-z0-9-]+)(?:\s+([\s\S]*))?$/.exec(text) : null;
        return match && chat.skills.some((skill) => skill.name === match[1]) ? {skill: match[1], words: match[2] ?? ""} : null;
    };
    // The skill and the words the box sends, and its prompt: the words typed,
    // or the skill alone named.
    const asked = named(draft);
    const skill = draftSkill ?? asked?.skill ?? null;
    const words = asked ? asked.words : draft;
    const message = promptOf(words, skill);

    // The skills a / at the start of the box lists, the one named whole first,
    // then those whose name begins with what follows it, then those holding it;
    // none once a skill is chosen, a space typed, Escape pressed on what is
    // typed or the box left.
    const [dismissed, setDismissed] = useState(false);
    const [active, setActive] = useState(0);
    const typed = draft.toLowerCase();
    const query = !draftSkill && chat.skills && /^\/[a-z0-9-]*$/.test(typed) ? typed.slice(1) : null;
    const matches = query === null
        ? []
        : [
            ...chat.skills.filter((item) => item.name === query),
            ...chat.skills.filter((item) => item.name !== query && item.name.startsWith(query)),
            ...chat.skills.filter((item) => !item.name.startsWith(query) && item.name.includes(query)),
        ];
    const listOpen = matches.length > 0 && !dismissed && !composerClosed;
    const activeIndex = Math.min(active, matches.length - 1);
    const choose = (name, rest = "") => {
        setDraftSkill(name);
        setDraft(rest);
        setActive(0);
        inputRef.current?.focus();
    };
    const clearMessage = () => {
        setDraft("");
        setDraftSkill(null);
    };
    // The option the arrows reach stays in sight.
    useEffect(() => {
        if (!listOpen) return;
        document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView?.({block: "nearest"});
    }, [listOpen, activeIndex, listId]);
    // A skill chosen that the list read again no longer holds goes, said so.
    const [skillGone, setSkillGone] = useState(null);
    useEffect(() => {
        if (!draftSkill || !chat.skills || chat.skills.some((item) => item.name === draftSkill)) return;
        setSkillGone(draftSkill);
        setDraftSkill(null);
    }, [draftSkill, chat.skills, setDraftSkill]);

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
        else {
            setDraft(prompt.text);
            setDraftSkill(null);
        }
        inputRef.current?.focus();
        // On the question, and what the chat does, only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [shared.prompt, ready, chat.historyReady, chat.pending, chat.confirmation, chat.conversation]);

    const submit = (event) => {
        event.preventDefault();
        if (composerClosed || !message.trim() || promptTooLarge) return;
        shared.clearPromptDropped();
        setSkillGone(null);
        const sentSkill = skill ?? undefined;
        if (queueing) {
            // One message queued at most: replacing it is asked first. The
            // queue keeps the words and the skill apart.
            if (chat.queued) {
                setReplacement({text: words, skill: sentSkill});
                return;
            }
            if (chat.queue(words, sentSkill)) clearMessage();
            inputRef.current?.focus();
            return;
        }
        clearMessage();
        void chat.send(message, undefined, undefined, sentSkill);
    };

    // After a stop or a failure, nothing goes alone: the user sends the queued
    // message again, or takes it back. Sent again, it goes with the page it
    // was asked from.
    const resend = () => {
        const context = chat.queued?.context;
        const model = chat.queued?.model;
        const queuedSkill = chat.queued?.skill;
        const prompt = promptOf(chat.takeQueued() ?? "", queuedSkill);
        if (prompt) void chat.send(prompt, context, model, queuedSkill);
    };

    const replace = () => {
        if (replacement !== null && chat.queue(replacement.text, replacement.skill)) clearMessage();
        setReplacement(null);
        inputRef.current?.focus();
    };

    return (
        <>
            {shared.promptDropped && <Alert tone="info" className="mx-3 mb-2">{t("ai.promptDropped")}</Alert>}
            <form onSubmit={submit} className={cn("space-y-2 border-t border-line", compact ? "p-2" : "p-3")}>
                {/* Always there, so that the first message queued is announced too. */}
                <p aria-live="polite" className="sr-only">
                    {chat.queued
                        ? untrustedT(t, "ai.queue.announce", {text: [chat.queued.skill && `/${chat.queued.skill}`, chat.queued.text].filter(Boolean).join(" ")})
                        : ""}
                </p>
                {/* The skill chosen, told as it is. */}
                <p aria-live="polite" className="sr-only">
                    {draftSkill ? t("ai.skills.chosen", {skill: draftSkill}) : ""}
                </p>
                {skillGone && <Alert tone="info">{t("ai.skills.gone", {skill: skillGone})}</Alert>}
                {chat.queued && (
                    <div
                        role="group"
                        aria-label={t("ai.queue.label")}
                        className="flex flex-wrap items-center gap-2 rounded-(--radius-control) border border-line bg-surface-sunken px-2 py-1 text-data"
                    >
                        <ClockIcon width={14} height={14} className="shrink-0 text-ink-muted"/>
                        <span className="text-ink-muted">{t("ai.queue.label")}</span>
                        {/* The skill asked, then the text of the user, as typed. */}
                        <span className="min-w-0 flex-1 truncate">
                            {chat.queued.skill && <span className="mr-1 font-mono">/{chat.queued.skill}</span>}
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
                            disabled={Boolean(draft.trim() || draftSkill)}
                            onClick={() => {
                                const skill = chat.queued?.skill ?? null;
                                setDraft(chat.takeQueued() ?? "");
                                setDraftSkill(skill);
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
                {draftSkill && (
                    <div className="flex items-center gap-2 text-data">
                        <span className="text-ink-muted">{t("ai.skills.tag")}</span>
                        <span className="inline-flex min-w-0 items-center gap-1 rounded-(--radius-control) border border-line bg-surface-sunken py-0.5 pr-0.5 pl-2 font-mono">
                            <span className="truncate">/{draftSkill}</span>
                            <button
                                type="button"
                                aria-label={t("ai.skills.remove", {skill: draftSkill})}
                                title={t("ai.skills.remove", {skill: draftSkill})}
                                disabled={composerClosed}
                                onClick={() => {
                                    setDraftSkill(null);
                                    inputRef.current?.focus();
                                }}
                                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-(--radius-control) text-ink-muted hover:bg-surface-raised hover:text-ink"
                            >
                                <CloseIcon width={12} height={12}/>
                            </button>
                        </span>
                    </div>
                )}
                {listOpen && (
                    <ul
                        id={listId}
                        role="listbox"
                        aria-label={t("ai.skills.list")}
                        className="max-h-48 overflow-y-auto rounded-(--radius-control) border border-line bg-surface-raised py-1 shadow-md"
                    >
                        {matches.map((skill, index) => (
                            <li
                                key={skill.name}
                                id={`${listId}-${index}`}
                                role="option"
                                aria-selected={index === activeIndex}
                                // The box keeps the focus.
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => choose(skill.name)}
                                className={cn("cursor-pointer px-2 py-1", index === activeIndex && "bg-surface-sunken")}
                            >
                                <span className="font-mono">/{skill.name}</span>
                                {/* Written by the authors of the skills, shown as text. */}
                                {skill.description && (
                                    <span className="line-clamp-2 text-ink-muted [overflow-wrap:anywhere]">{skill.description}</span>
                                )}
                            </li>
                        ))}
                    </ul>
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
                                    : chat.skills && !draftSkill
                                        ? `${t("ai.composer.hint")} ${t("ai.composer.skillsHint")}`
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
                            {...(chat.skills ? {
                                "aria-autocomplete": "list",
                                "aria-controls": listOpen ? listId : undefined,
                                "aria-activedescendant": listOpen ? `${listId}-${activeIndex}` : undefined,
                            } : {})}
                            onChange={(event) => {
                                const value = event.target.value;
                                setActive(0);
                                setDismissed(false);
                                shared.clearPromptDropped();
                                // A skill named whole, then a space: chosen.
                                const whole = /\s$/.test(value) ? named(value) : null;
                                if (whole) choose(whole.skill, whole.words);
                                else setDraft(value);
                            }}
                            onBlur={() => setDismissed(true)}
                            onFocus={() => setDismissed(false)}
                            onKeyDown={(event) => {
                                const composing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
                                if (listOpen && !composing) {
                                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                                        event.preventDefault();
                                        const step = event.key === "ArrowDown" ? 1 : -1;
                                        setActive((activeIndex + step + matches.length) % matches.length);
                                        return;
                                    }
                                    if (!event.shiftKey && (event.key === "Enter" || event.key === "Tab")) {
                                        event.preventDefault();
                                        choose(matches[activeIndex].name);
                                        return;
                                    }
                                    if (event.key === "Escape") {
                                        // The list closes; the dock stays open.
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setDismissed(true);
                                        return;
                                    }
                                }
                                // Backspace in an empty box takes the skill back.
                                if (event.key === "Backspace" && !event.repeat && !composing && draft === "" && draftSkill) {
                                    event.preventDefault();
                                    setDraftSkill(null);
                                    return;
                                }
                                if (event.key !== "Enter" || event.shiftKey || composing) return;
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
                        disabled={composerClosed || !message.trim() || promptTooLarge}
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
