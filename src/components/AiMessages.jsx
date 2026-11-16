import {useState} from "react";
import {useTranslation} from "react-i18next";
import AiMarkdown from "./AiMarkdown.jsx";
import {AiSteps, AnswerFooter} from "./AiSteps.jsx";
import {Button} from "../ui/components/Button";
import {Checkbox, Field, Textarea} from "../ui/components/Field";
import {FEEDBACK_REASONS, MAX_FEEDBACK_EXPECTED_CHARACTERS} from "../services/ai-agent.js";
import {Spinner} from "../ui/components/Spinner";
import {PencilIcon} from "../ui/icons";
import {cn} from "../ui/cn";

/**
 * The feedback of the user on the answer of a turn: helpful, or to improve
 * with optional reasons and what they expected. Clicking the active rating
 * again withdraws it.
 */
function Feedback({rating, onRate, onUnrate}) {
    const {t} = useTranslation();
    const current = rating?.feedback || null;
    const pending = Boolean(rating?.pending);
    const [form, setForm] = useState(null);
    const expectedLength = form ? Array.from(form.expected.trim()).length : 0;
    const tooLong = expectedLength > MAX_FEEDBACK_EXPECTED_CHARACTERS;

    const openForm = () =>
        setForm({
            reasons: current?.rating === "down" ? current.reasons : [],
            expected: current?.rating === "down" ? current.expected : "",
        });
    const clickUp = () => {
        setForm(null);
        void (current?.rating === "up" ? onUnrate() : onRate({rating: "up"}));
    };
    const clickDown = () => {
        if (current?.rating === "down") {
            setForm(null);
            void onUnrate();
        } else if (form) {
            setForm(null);
        } else {
            openForm();
        }
    };
    const toggleReason = (reason) =>
        setForm((previous) => ({
            ...previous,
            reasons: previous.reasons.includes(reason)
                ? previous.reasons.filter((item) => item !== reason)
                : [...previous.reasons, reason],
        }));
    const send = async (event) => {
        event.preventDefault();
        if (tooLong || pending) return;
        if (await onRate({rating: "down", reasons: form.reasons, expected: form.expected})) setForm(null);
    };

    return (
        <div className="mt-2 space-y-2 text-data">
            <div role="group" aria-label={t("ai.feedback.rate")} className="flex flex-wrap items-center gap-2">
                <Button size="sm" aria-pressed={current?.rating === "up"} disabled={pending} onClick={clickUp}>
                    <span aria-hidden="true">👍</span> {t("ai.feedback.helpful")}
                </Button>
                <Button
                    size="sm"
                    aria-pressed={current?.rating === "down"}
                    aria-expanded={Boolean(form)}
                    disabled={pending}
                    onClick={clickDown}
                >
                    <span aria-hidden="true">👎</span> {t("ai.feedback.improve")}
                </Button>
                {current?.rating === "down" && !form && (
                    <Button size="sm" icon={<PencilIcon width={12} height={12}/>} disabled={pending} onClick={openForm}>
                        {t("ai.feedback.edit")}
                    </Button>
                )}
                {pending && <Spinner label={t("ai.feedback.saving")}/>}
                {current && !pending && !form && <span className="text-ink-muted">{t("ai.feedback.thanks")}</span>}
            </div>
            {rating?.error && <p role="alert" className="text-state-down">{rating.error}</p>}
            {form && (
                <form aria-label={t("ai.feedback.details")} onSubmit={send} className="space-y-2 rounded-(--radius-control) border border-line bg-surface-sunken p-2">
                    <fieldset className="space-y-1">
                        <legend className="mb-1 font-medium">{t("ai.feedback.reasonsLegend")}</legend>
                        {FEEDBACK_REASONS.map((reason) => (
                            <div key={reason}>
                                <Checkbox
                                    label={t(`ai.feedback.reasons.${reason}`)}
                                    checked={form.reasons.includes(reason)}
                                    disabled={pending}
                                    onChange={() => toggleReason(reason)}
                                />
                            </div>
                        ))}
                    </fieldset>
                    <Field
                        label={t("ai.feedback.expected")}
                        hint={tooLong ? undefined : t("ai.feedback.length", {length: expectedLength, max: MAX_FEEDBACK_EXPECTED_CHARACTERS})}
                        error={tooLong ? t("ai.feedback.tooLong", {max: MAX_FEEDBACK_EXPECTED_CHARACTERS}) : undefined}
                    >
                        {(control) => (
                            <Textarea
                                {...control}
                                rows={3}
                                className="resize-y"
                                value={form.expected}
                                disabled={pending}
                                onChange={(event) => setForm((previous) => ({...previous, expected: event.target.value}))}
                            />
                        )}
                    </Field>
                    <p className="text-ink-muted">{t("ai.feedback.privacy")}</p>
                    <div className="flex justify-end gap-2">
                        <Button size="sm" disabled={pending} onClick={() => setForm(null)}>
                            {t("ai.feedback.cancel")}
                        </Button>
                        <Button size="sm" type="submit" disabled={pending || tooLong}>
                            {t("ai.feedback.send")}
                        </Button>
                    </div>
                </form>
            )}
        </div>
    );
}

/** One message of the transcript: the text, the steps of its tools and the turn state. */
function Message({message, feedback, status}) {
    const {t} = useTranslation();
    const user = message.role === "user";
    return (
        <li
            className={cn(
                "w-fit max-w-full rounded-(--radius-control) border border-line px-3 py-2",
                user ? "self-end bg-surface-sunken" : "self-start bg-surface"
            )}
        >
            <p className="mb-1 text-data font-semibold text-ink-muted">{user ? t("ai.message.you") : t("ai.message.assistant")}</p>
            {!user && <AiSteps message={message} status={status}/>}
            {message.text && !user && <AiMarkdown text={message.text} objects={status?.objects}/>}
            {message.text && user && <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{message.text}</div>}
            {message.status === "awaiting_confirmation" && (
                <p className="mt-1 text-data text-state-warn">{t("ai.message.awaiting")}</p>
            )}
            {["stopped", "failed"].includes(message.status) && (
                <p className="mt-1 text-data text-state-warn">{t(`ai.message.${message.status}`)}</p>
            )}
            {!user && message.status !== "running" && <AnswerFooter message={message}/>}
            {feedback}
        </li>
    );
}

/**
 * The messages of the conversation shown, the page's and the dock's: each answer
 * with its steps, the last one of a turn, completed, rated by the user.
 * `status`, the state of the cluster, which names the objects the answers link.
 */
export default function AiMessages({chat, status}) {
    return (
        <ul className="flex flex-col gap-3">
            {chat.messages.map((message, index) => {
                // The answer of a turn is its last assistant message, once completed.
                const next = chat.messages[index + 1];
                const rateable =
                    message.role === "assistant" &&
                    message.status === "completed" &&
                    typeof message.turn_id === "string" &&
                    !(next?.role === "assistant" && next.turn_id === message.turn_id);
                return (
                    <Message
                        key={message.id}
                        message={message}
                        status={status}
                        feedback={
                            rateable && (
                                <Feedback
                                    rating={chat.ratings[message.turn_id]}
                                    onRate={(value) => chat.rate(message.turn_id, value)}
                                    onUnrate={() => chat.unrate(message.turn_id)}
                                />
                            )
                        }
                    />
                );
            })}
        </ul>
    );
}
