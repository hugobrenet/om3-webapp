import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {useTranslation} from "react-i18next";
import {useAuth} from "../context/AuthProvider.jsx";
import useFetchDaemonStatus from "../hooks/useFetchDaemonStatus.jsx";
import useAiAgent from "../hooks/useAiAgent.js";
import useAiChat from "../hooks/useAiChat.js";
import {isFrozen, objectAttention} from "../hooks/useSidebarAlerts.js";
import AiMarkdown from "./AiMarkdown.jsx";
import {AiSteps, AnswerFooter} from "./AiSteps.jsx";
import {ConfigText} from "./ConfigText.jsx";
import {parseObjectPath} from "../utils/objectUtils.jsx";
import {URL_OBJECT} from "../config/apiPath.js";
import AiArgumentsForm, {argumentsOf, compileSchema, draftOf, formFields, sameArguments, schemaErrors} from "./AiArgumentsForm.jsx";
import {Alert} from "../ui/components/Alert";
import {Button, IconButton} from "../ui/components/Button";
import {Dialog} from "../ui/components/Dialog";
import {Checkbox, Field, Input, Textarea} from "../ui/components/Field";
import {FEEDBACK_REASONS, MAX_FEEDBACK_EXPECTED_CHARACTERS} from "../services/ai-agent.js";
import {Spinner} from "../ui/components/Spinner";
import {AlertTriangleIcon, ChatIcon, PencilIcon, PlusIcon, SearchIcon, SendIcon, SidebarIcon, StopIcon, TrashIcon} from "../ui/icons";
import {NARROW_QUERY, useMediaQuery} from "../ui/lib/media";
import {cn} from "../ui/cn";
import {untrustedT} from "../utils/untrustedText";

const PANEL = "flex min-h-0 min-w-0 flex-col rounded-(--radius-panel) border border-line bg-surface-raised";
const PANEL_HEADER = "flex flex-wrap items-center gap-2 border-b border-line px-3 py-2";

const CONVERSATIONS_KEY = "om3.ai.conversations";
const CONVERSATIONS_PANEL = "ai-conversations-panel";

/** Folding the conversations is a display comfort, specific to the browser, as the menu. */
function readConversationsOpen() {
    try {
        return localStorage.getItem(CONVERSATIONS_KEY) !== "closed";
    } catch {
        // Private browsing or storage refused: the panel opens, as by default.
        return true;
    }
}

/**
 * Open state of the conversations panel, and what toggles it. A wide window
 * remembers it in local storage. A narrow one has it folded: by default, on
 * becoming so, and once a conversation is chosen (`fold`), a choice not remembered.
 */
export function useConversationsOpen() {
    const narrow = useMediaQuery(NARROW_QUERY);
    const [open, setOpen] = useState(readConversationsOpen);
    const [narrowOpen, setNarrowOpen] = useState(false);
    useEffect(() => {
        if (narrow) setNarrowOpen(false);
    }, [narrow]);
    const toggle = useCallback(() => {
        if (narrow) {
            setNarrowOpen((previous) => !previous);
            return;
        }
        setOpen((previous) => {
            const next = !previous;
            try {
                localStorage.setItem(CONVERSATIONS_KEY, next ? "open" : "closed");
            } catch {
                // Preference not remembered: without consequence for the current session.
            }
            return next;
        });
    }, [narrow]);
    const fold = useCallback(() => setNarrowOpen(false), []);
    return [narrow ? narrowOpen : open, toggle, {narrow, fold}];
}

export const CONVERSATION_GROUPS = ["today", "yesterday", "week", "older"];

/** The time of the last change of a conversation, NaN when it has none readable. */
const changedAt = (conversation) => Date.parse(conversation.updated_at || conversation.created_at || "");

/**
 * The conversations by the day of their last change, in the local time of `now`:
 * today, yesterday, the 7 days before, older. Each group is sorted from the most
 * recent; a conversation without a readable date goes to the older ones.
 */
export function groupConversations(conversations, now = new Date()) {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const week = new Date(today);
    week.setDate(today.getDate() - 7);
    const groups = Object.fromEntries(CONVERSATION_GROUPS.map((key) => [key, []]));
    for (const conversation of conversations) {
        const time = changedAt(conversation);
        const key = !Number.isFinite(time)
            ? "older"
            : time >= today.getTime()
                ? "today"
                : time >= yesterday.getTime()
                    ? "yesterday"
                    : time >= week.getTime()
                        ? "week"
                        : "older";
        groups[key].push(conversation);
    }
    const recentFirst = (left, right) => (changedAt(right) || 0) - (changedAt(left) || 0);
    return CONVERSATION_GROUPS.filter((key) => groups[key].length).map((key) => ({key, items: groups[key].sort(recentFirst)}));
}

/**
 * The first questions offered on a conversation without messages, at most four:
 * an object down, else one warn, then a frozen node, then two general ones. They
 * come from the state of the menu pills; paths and node names are untrusted text,
 * put in the question as they are and only ever rendered as text.
 */
export function starterQuestions(status, t) {
    const objects = status?.objects || {};
    const nodes = status?.nodeStatus || {};
    const paths = Object.keys(objects).sort();
    const questions = [];
    const object =
        paths.find((path) => objectAttention(path, objects[path]) === "down") ??
        paths.find((path) => objectAttention(path, objects[path]) === "warn");
    if (object !== undefined) {
        const state = objectAttention(object, objects[object]);
        questions.push(untrustedT(t, "ai.starters.object", {path: object, state}));
    }
    const frozen = Object.keys(nodes).sort().find((node) => isFrozen(nodes[node]));
    if (frozen !== undefined) questions.push(untrustedT(t, "ai.starters.frozen", {node: frozen}));
    questions.push(t("ai.starters.stopped"), t("ai.starters.heartbeats"));
    return questions.slice(0, 4);
}

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
 * The sentence of a preview, said in the language of the page from its key
 * and params when the page knows the key, as the MCP wrote it otherwise. The
 * params come from the arguments of the model: inserted as text, never read
 * as Markdown nor as placeholders.
 */
function previewSentence(summary, t, i18n) {
    const name = `ai.confirm.summary.${summary.key}`;
    if (!i18n.exists(name)) return summary.text;
    const template = String(i18n.getResource(i18n.resolvedLanguage ?? i18n.language, "translation", name) ?? i18n.getResource("en", "translation", name) ?? "");
    // A sentence missing one of its params is the one of the MCP.
    const named = [...template.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]);
    if (named.some((param) => typeof summary.params[param] !== "string")) return summary.text;
    let sentence = untrustedT(t, name, summary.params);
    // The optional params end the sentence of an action, unless it names them.
    for (const param of ["rids", "to"]) {
        if (summary.params[param] && !template.includes(`{{${param}}}`))
            sentence += untrustedT(t, `ai.confirm.suffix.${param}`, {[param]: summary.params[param]});
    }
    return sentence;
}

/** A value of the preview, as text; its absence, by what it means. */
function PreviewValue({value, missing}) {
    if (value === undefined || value === "") return <span className="text-ink-muted italic">{missing}</span>;
    return <code className="break-all whitespace-pre-wrap">{value}</code>;
}

/** The URL of the keywords of the kind of an object, for the help of its file. */
const keywordsUrlOf = (path) => {
    const {namespace, kind, name} = parseObjectPath(path);
    return `${URL_OBJECT}/${[namespace, kind, name].map(encodeURIComponent).join("/")}/config/keywords`;
};

/**
 * What the call would do, as the MCP told it: the keys it changes, with their
 * configured value read now and the one the MCP computes, the sections it
 * deletes with their keys, the file it writes.
 */
function PreviewDetails({preview, path}) {
    const {t, i18n} = useTranslation();
    // The notes of a change, said in the language of the page by their keys
    // when it knows them all, as the MCP wrote them otherwise.
    const note = (change) =>
        change.noteKeys.length > 0 && change.noteKeys.every((key) => i18n.exists(`ai.confirm.notes.${key}`))
            ? change.noteKeys.map((key) => t(`ai.confirm.notes.${key}`)).join("; ")
            : change.note;
    // A creation has no current values: the column is left out.
    const current = preview.changes.some((change) => change.before !== undefined);
    return (
        <div className="space-y-2 text-data">
            {preview.changes.length > 0 && (
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-left">
                        <caption className="sr-only">{t("ai.confirm.changes")}</caption>
                        <thead>
                            <tr className="border-b border-line text-ink-muted">
                                <th scope="col" className="py-1 pr-3 font-medium">{t("ai.confirm.key")}</th>
                                {current && <th scope="col" className="py-1 pr-3 font-medium">{t("ai.confirm.current")}</th>}
                                <th scope="col" className="py-1 pr-3 font-medium">{t("ai.confirm.operation")}</th>
                                <th scope="col" className="py-1 font-medium">{t("ai.confirm.proposed")}<span aria-hidden="true">*</span></th>
                            </tr>
                        </thead>
                        <tbody>
                            {preview.changes.map((change, index) => {
                                const secret = change.before === undefined && change.after === undefined && change.value === undefined && change.op !== "unset";
                                return (
                                    <tr key={index} className="border-b border-line align-top last:border-b-0">
                                        <th scope="row" className="py-1 pr-3 font-normal">
                                            <code className="break-all">{change.key}</code>
                                            {change.note && <span className="block text-ink-muted">{note(change)}</span>}
                                        </th>
                                        {current && (
                                            <td className="py-1 pr-3">
                                                <PreviewValue value={change.before} missing={secret ? t("ai.confirm.hidden") : t("ai.confirm.empty")}/>
                                            </td>
                                        )}
                                        <td className="py-1 pr-3">
                                            {t(`ai.confirm.ops.${change.op}`)}
                                            {change.value !== undefined && (
                                                <>
                                                    {" "}
                                                    <code className="break-all whitespace-pre-wrap">{change.value}</code>
                                                </>
                                            )}
                                        </td>
                                        <td className="py-1">
                                            {change.after !== undefined ? (
                                                <PreviewValue value={change.after} missing={t("ai.confirm.empty")}/>
                                            ) : (
                                                <span className="text-ink-muted italic">{secret ? t("ai.confirm.hidden") : t("ai.confirm.notComputed")}</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <p className="mt-1 text-ink-muted"><span aria-hidden="true">* </span>{t("ai.confirm.computed")}</p>
                </div>
            )}
            {preview.deleted.map((section) => (
                <div key={section.section}>
                    <p>
                        {section.keys.length
                            ? untrustedT(t, "ai.confirm.deleted", {section: section.section}, {count: section.keys.length})
                            : untrustedT(t, "ai.confirm.deletedEmpty", {section: section.section})}
                    </p>
                    {section.secretsOmitted > 0 && (
                        <p className="text-ink-muted">{t("ai.confirm.deletedSecrets", {count: section.secretsOmitted})}</p>
                    )}
                    {section.keys.length > 0 && (
                        <ul aria-label={section.section} className="ml-4 list-disc">
                            {section.keys.map((key) => (
                                <li key={key}><code className="break-all">{key}</code></li>
                            ))}
                        </ul>
                    )}
                </div>
            ))}
            {preview.content && (
                <div className="space-y-1">
                    <ConfigText
                        text={preview.content.text}
                        label={t("ai.confirm.content")}
                        lineNumbers
                        keywordsUrl={path ? keywordsUrlOf(path) : undefined}
                    />
                    {preview.content.truncated && <p className="text-ink-muted">{t("ai.confirm.contentTruncated")}</p>}
                </div>
            )}
            {preview.secretsOmitted > 0 && <p className="text-ink-muted">{t("ai.confirm.secrets", {count: preview.secretsOmitted})}</p>}
            {preview.warnings.map((warning, index) => (
                <p key={index} className="text-state-warn">{warning}</p>
            ))}
            {preview.readAt && (
                <p className="text-ink-muted">{t("ai.confirm.readAt", {time: new Date(preview.readAt).toLocaleTimeString()})}</p>
            )}
        </div>
    );
}

/** One argument of the call, its value as JSON when it is not a plain string. */
const argumentValue = (value) => (typeof value === "string" ? value : JSON.stringify(value));

/**
 * The value of one argument. A text of the media type the tool declares, such
 * as a YAML, or holding line breaks, keeps its lines and indentation: the user
 * confirms the text that runs.
 */
function ArgumentValue({value, type}) {
    if (typeof value !== "string" || (!type && !value.includes("\n"))) return <code>{argumentValue(value)}</code>;
    return (
        <div className="space-y-1">
            {type && <p className="text-ink-muted">{type}</p>}
            <pre className="max-h-64 overflow-auto whitespace-pre rounded-(--radius-control) border border-line bg-surface p-2 font-mono">
                {value}
            </pre>
        </div>
    );
}

/**
 * The tool call waiting for the decision of the user. It shows the call as the
 * agent stored it, the one that runs if approved, never the model text; and,
 * when the MCP told it, what the call would do. After an edit, the preview is
 * asked again for the edited arguments, nothing running.
 */
function ConfirmationCard({confirmation, busy, previewing, onApprove, onReject, onPreview}) {
    const {t, i18n} = useTranslation();
    const expires = new Date(confirmation.expires_at).toLocaleTimeString();
    const entries = Object.entries(confirmation.arguments);
    const argumentTypes = confirmation.argument_types || {};
    const preview = confirmation.preview || null;
    // A call the user may edit is shown in a form built from the input schema
    // of its tool, the arguments the model proposed filled in.
    const fields = useMemo(
        () => (confirmation.editable ? formFields(confirmation.input_schema, confirmation.arguments, argumentTypes) : []),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [confirmation]
    );
    const validate = useMemo(() => (confirmation.editable ? compileSchema(confirmation.input_schema) : null), [confirmation]);
    const proposedDrafts = useMemo(
        () => Object.fromEntries(fields.map((field) => [field.name, draftOf(field, confirmation.arguments[field.name])])),
        [fields, confirmation]
    );
    // A preview asked again for an edit comes back with that edit: the form
    // shows it again.
    const previewDrafts = useMemo(
        () =>
            confirmation.preview_arguments
                ? Object.fromEntries(fields.map((field) => [field.name, draftOf(field, confirmation.preview_arguments[field.name])]))
                : null,
        [fields, confirmation]
    );
    const [editing, setEditing] = useState(Boolean(previewDrafts));
    const [drafts, setDrafts] = useState(previewDrafts ?? proposedDrafts);
    useEffect(() => {
        setEditing(Boolean(previewDrafts));
        setDrafts(previewDrafts ?? proposedDrafts);
    }, [proposedDrafts, previewDrafts]);
    const edit = editing ? argumentsOf(fields, drafts, confirmation.arguments) : null;
    const changed = Boolean(edit) && !sameArguments(edit.args, confirmation.arguments);
    const errors = edit ? {...(changed ? schemaErrors(validate, edit.args) : {}), ...edit.errors} : {};
    const invalid = Object.keys(errors).length > 0;
    const approve = () => onApprove(changed ? edit.args : undefined);
    // The arguments the preview is of: those of the call, or an edit.
    const previewOf = confirmation.preview_arguments || confirmation.arguments;
    const stale = Boolean(edit) && !invalid && !sameArguments(edit.args, previewOf);
    const path = typeof previewOf.path === "string" ? previewOf.path : "";

    return (
        <section
            aria-label={t("ai.confirm.region")}
            className="mx-3 mb-2 max-h-[60vh] space-y-2 overflow-y-auto rounded-(--radius-control) border border-state-warn bg-state-warn-soft p-3"
        >
            <p className="flex items-center gap-2 font-semibold text-state-warn">
                <AlertTriangleIcon width={16} height={16}/>
                {confirmation.tool.destructive ? t("ai.confirm.destructive") : t("ai.confirm.action")}
            </p>
            {preview && <p className="font-medium [overflow-wrap:anywhere]">{previewSentence(preview.summary, t, i18n)}</p>}
            <p className="[overflow-wrap:anywhere]">
                <span className={preview ? "text-data text-ink-muted" : "font-medium"}>{confirmation.tool.title}</span>{" "}
                <code className="text-data text-ink-muted">{confirmation.tool.name}</code>
            </p>
            {preview && <PreviewDetails preview={preview} path={path}/>}
            {confirmation.preview_error && (
                <p className="text-data text-ink-muted">{untrustedT(t, "ai.confirm.previewError", {error: confirmation.preview_error})}</p>
            )}
            {preview && confirmation.preview_arguments && !stale && <p className="text-data text-ink-muted">{t("ai.confirm.previewOfEdit")}</p>}
            {preview && stale && <p className="text-data text-state-warn">{t("ai.confirm.previewStale")}</p>}
            {editing ? (
                <form
                    aria-label={t("ai.confirm.form")}
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (!busy && !invalid) approve();
                    }}
                >
                    <AiArgumentsForm
                        fields={fields}
                        drafts={drafts}
                        errors={errors}
                        disabled={busy}
                        onChange={(name, value) => setDrafts((previous) => ({...previous, [name]: value}))}
                    />
                </form>
            ) : entries.length > 0 ? (
                <details open={!preview} className="text-data">
                    <summary className="cursor-pointer text-ink-muted">{t("ai.confirm.arguments")}</summary>
                    <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
                        {entries.map(([name, value]) => (
                            <div key={name} className="contents">
                                <dt className="font-medium">{name}</dt>
                                <dd className="min-w-0 [overflow-wrap:anywhere]">
                                    <ArgumentValue
                                        value={value}
                                        type={Object.hasOwn(argumentTypes, name) ? argumentTypes[name] : ""}
                                    />
                                </dd>
                            </div>
                        ))}
                    </dl>
                </details>
            ) : (
                <p className="text-data text-ink-muted">{t("ai.confirm.noArguments")}</p>
            )}
            <p className="text-data text-ink-muted">
                {t("ai.confirm.expires", {time: expires})}
                {changed && t("ai.confirm.withChanges")}
            </p>
            {preview && <p className="text-data text-ink-muted">{t("ai.confirm.daemonMayRefuse")}</p>}
            <div className="flex flex-wrap items-center justify-end gap-2">
                {previewing && <Spinner label={t("ai.confirm.previewing")}/>}
                {confirmation.editable && !editing && (
                    <Button icon={<PencilIcon/>} disabled={busy} onClick={() => setEditing(true)}>
                        {t("ai.confirm.edit")}
                    </Button>
                )}
                {editing && (
                    <Button
                        disabled={busy}
                        onClick={() => {
                            setDrafts(proposedDrafts);
                            setEditing(false);
                        }}
                    >
                        {t("ai.confirm.discard")}
                    </Button>
                )}
                {editing && preview && changed && (
                    <Button disabled={busy || invalid || !stale} onClick={() => onPreview(edit.args)}>
                        {t("ai.confirm.recompute")}
                    </Button>
                )}
                <Button disabled={busy} onClick={onReject}>
                    {t("ai.confirm.reject")}
                </Button>
                <Button variant={confirmation.tool.destructive ? "delete" : "create"} disabled={busy || invalid} onClick={approve}>
                    {changed ? t("ai.confirm.approveEdited") : t("ai.confirm.approve")}
                </Button>
            </div>
        </section>
    );
}

/**
 * The assistant page. It fills the height of the view: the transcript scrolls
 * between its header and the message box, which stays at the bottom. `status`
 * is the state of the menu pills, objects by path and node status by node, the
 * first questions offered come from.
 */
const AiChat = ({status}) => {
    const {t} = useTranslation();
    const auth = useAuth();
    const {clusterId, clusterName, loading, error: statusError, fetchNodes} = useFetchDaemonStatus();
    const {enabled, ready, configurationError, client} = useAiAgent({clusterId});
    // A conversation belongs to an identity on a cluster: changing either resets the view.
    const scope = JSON.stringify([auth.authChoice, auth.user, clusterId]);
    const chat = useAiChat({client, ready, scope});
    const [conversationsOpen, toggleConversations, {fold: foldConversations}] = useConversationsOpen();
    const [search, setSearch] = useState("");
    const [draft, setDraft] = useState("");
    const [dialog, setDialog] = useState("");
    const [title, setTitle] = useState("");
    const transcript = useRef(null);
    const scrollAnchor = useRef(null);
    const busy = Boolean(chat.pending);
    const waiting = Boolean(chat.confirmation);
    const promptTooLarge = new TextEncoder().encode(draft).length > 32 * 1024;
    const untitled = t("ai.conversations.untitled");
    const titleOf = (conversation) => conversation.title || untitled;
    // The search runs on the titles of the conversations loaded, the agent has none.
    const needle = search.trim().toLocaleLowerCase();
    const groups = groupConversations(
        needle ? chat.conversations.filter((conversation) => titleOf(conversation).toLocaleLowerCase().includes(needle)) : chat.conversations
    );
    const starters =
        chat.historyReady && !busy && !waiting && !chat.messages.length ? starterQuestions(status, t) : [];

    useEffect(() => {
        if (enabled && auth.accessToken) void fetchNodes(auth.accessToken);
    }, [enabled, auth.authChoice, auth.accessToken, fetchNodes]);

    useEffect(() => {
        setDraft("");
        setDialog("");
        setTitle("");
    }, [scope, ready, chat.conversation?.id, chat.historyReady]);

    // Before paint: prepended messages keep the reading position without a jump.
    useLayoutEffect(() => {
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
        if (!ready || !chat.historyReady || busy || waiting || !draft.trim() || promptTooLarge) return;
        const prompt = draft;
        setDraft("");
        void chat.send(prompt);
    };

    const confirmDialog = async () => {
        const result = dialog === "rename" ? await chat.renameConversation(title) : await chat.deleteConversation();
        if (result) setDialog("");
    };

    return (
        <div className="flex h-full min-h-0 flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center gap-3">
                <h1 className="flex items-center gap-2 text-title font-semibold">
                    <ChatIcon width={18} height={18} className="text-ink-muted"/>
                    {t("ai.title")}
                </h1>
                {ready && (
                    <span className="rounded-full border border-line px-2 py-0.5 text-data text-ink-muted">
                        {clusterName || t("ai.cluster")}
                    </span>
                )}
            </div>

            {!enabled && <Alert tone="info">{configurationError || t("ai.notConfigured")}</Alert>}
            {enabled && !auth.accessToken && <Alert tone="info">{t("ai.authRequired")}</Alert>}
            {enabled && auth.accessToken && !ready && (
                <Alert
                    tone={statusError ? "error" : "info"}
                    action={
                        <Button size="sm" disabled={loading} onClick={() => fetchNodes(auth.accessToken)}>
                            {t("ai.refreshStatus")}
                        </Button>
                    }
                >
                    {statusError || (loading ? t("ai.loadingCluster") : t("ai.waitingCluster"))}
                </Alert>
            )}

            {ready && (
                <div
                    className={cn(
                        "grid min-h-0 flex-1 gap-3",
                        // Narrow, the open panel stands above the transcript.
                        conversationsOpen
                            ? "grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[16rem_minmax(0,1fr)] md:grid-rows-1"
                            : "grid-rows-1"
                    )}
                >
                    <section
                        id={CONVERSATIONS_PANEL}
                        aria-labelledby="ai-conversations"
                        hidden={!conversationsOpen}
                        className={cn(PANEL, "max-md:max-h-[40vh]")}
                    >
                        <div className={PANEL_HEADER}>
                            <h2 id="ai-conversations" className="font-semibold">{t("ai.conversations.title")}</h2>
                        </div>
                        <div className="space-y-2 p-3">
                            <Button
                                variant="create"
                                icon={<PlusIcon/>}
                                disabled={busy}
                                onClick={() => {
                                    foldConversations();
                                    void chat.createConversation();
                                }}
                            >
                                {t("ai.conversations.new")}
                            </Button>
                            {chat.conversations.length > 0 && (
                                <div className="relative">
                                    <SearchIcon
                                        width={14}
                                        height={14}
                                        aria-hidden="true"
                                        className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-ink-muted"
                                    />
                                    <Input
                                        type="search"
                                        aria-label={t("ai.conversations.search")}
                                        title={t("ai.conversations.searchHint")}
                                        placeholder={t("ai.conversations.search")}
                                        className="pl-7"
                                        value={search}
                                        onChange={(event) => setSearch(event.target.value)}
                                    />
                                </div>
                            )}
                            {chat.pending === "loading" && <Spinner label={t("ai.conversations.loading")}/>}
                            {!chat.conversations.length && !busy && (
                                <p className="text-ink-muted">{t("ai.conversations.empty")}</p>
                            )}
                            {chat.conversations.length > 0 && !groups.length && (
                                <p className="text-ink-muted">{t("ai.conversations.noMatch")}</p>
                            )}
                        </div>
                        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3">
                            {groups.map((group) => (
                                <div key={group.key}>
                                    <h3 id={`ai-conversations-${group.key}`} className="mb-1 px-2 text-data font-semibold text-ink-muted">
                                        {t(`ai.conversations.groups.${group.key}`)}
                                    </h3>
                                    <ul aria-labelledby={`ai-conversations-${group.key}`} className="space-y-0.5">
                                        {group.items.map((conversation) => {
                                            const selected = conversation.id === chat.conversation?.id;
                                            return (
                                                <li key={conversation.id}>
                                                    <button
                                                        type="button"
                                                        aria-current={selected ? "true" : undefined}
                                                        disabled={busy}
                                                        onClick={() => {
                                                            foldConversations();
                                                            void chat.resumeConversation(conversation.id);
                                                        }}
                                                        className={cn(
                                                            "w-full rounded-(--radius-control) px-2 py-1 text-left [overflow-wrap:anywhere] disabled:opacity-60",
                                                            selected
                                                                ? "bg-surface-sunken font-medium text-ink"
                                                                : "text-ink-muted hover:bg-surface-sunken hover:text-ink"
                                                        )}
                                                    >
                                                        {titleOf(conversation)}
                                                    </button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section aria-labelledby="ai-transcript" className={PANEL}>
                        <div className={PANEL_HEADER}>
                            <IconButton
                                label={conversationsOpen ? t("ai.conversations.hide") : t("ai.conversations.show")}
                                aria-expanded={conversationsOpen}
                                aria-controls={CONVERSATIONS_PANEL}
                                onClick={toggleConversations}
                            >
                                <SidebarIcon open={conversationsOpen} width={14} height={14}/>
                            </IconButton>
                            <h2 id="ai-transcript" className="min-w-0 font-semibold [overflow-wrap:anywhere]">
                                {chat.conversation ? titleOf(chat.conversation) : t("ai.transcript.start")}
                            </h2>
                            <div className="ml-auto flex gap-2">
                                {/* Folded, the panel still lets a conversation start from here. */}
                                {!conversationsOpen && (
                                    <Button size="sm" icon={<PlusIcon/>} disabled={busy} onClick={() => chat.createConversation()}>
                                        {t("ai.conversations.new")}
                                    </Button>
                                )}
                                {chat.conversation && (
                                    <>
                                        <Button
                                            size="sm"
                                            icon={<PencilIcon/>}
                                            disabled={busy}
                                            onClick={() => {
                                                setTitle(chat.conversation.title || "");
                                                setDialog("rename");
                                            }}
                                        >
                                            {t("ai.transcript.rename")}
                                        </Button>
                                        <Button size="sm" icon={<TrashIcon/>} disabled={busy} onClick={() => setDialog("delete")}>
                                            {t("ai.transcript.delete")}
                                        </Button>
                                    </>
                                )}
                            </div>
                        </div>
                        <div
                            ref={transcript}
                            role="log"
                            aria-label={t("ai.transcript.log")}
                            aria-live="polite"
                            aria-relevant="additions text"
                            className="min-h-48 flex-1 overflow-y-auto p-3"
                        >
                            {chat.historyCursor && (
                                <Button size="sm" className="mb-3" disabled={busy} onClick={loadOlder}>
                                    {chat.pending === "history" ? t("ai.transcript.loadingEarlier") : t("ai.transcript.loadEarlier")}
                                </Button>
                            )}
                            {!chat.messages.length && (
                                <p className="text-ink-muted">
                                    {chat.pending === "resuming"
                                        ? t("ai.transcript.loadingSaved")
                                        : !chat.historyReady
                                            ? t("ai.transcript.reselect")
                                            : t("ai.transcript.empty")}
                                </p>
                            )}
                            {starters.length > 0 && (
                                <ul aria-label={t("ai.starters.label")} className="mt-3 flex flex-wrap gap-2">
                                    {starters.map((question) => (
                                        <li key={question} className="max-w-full">
                                            {/* Reads only: a click sends the question as it reads. */}
                                            <Button
                                                className="h-auto max-w-full py-1 text-left [overflow-wrap:anywhere]"
                                                onClick={() => void chat.send(question)}
                                            >
                                                {question}
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                            )}
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
                        </div>
                        {chat.confirmation && (
                            <ConfirmationCard
                                // A new confirmation, such as a preview asked again, takes a card of its own.
                                key={chat.confirmation.id}
                                confirmation={chat.confirmation}
                                busy={busy}
                                previewing={chat.pending === "previewing"}
                                onApprove={(editedArgs) => void chat.approve(editedArgs)}
                                onReject={() => void chat.reject()}
                                onPreview={(editedArgs) => void chat.previewAgain(editedArgs)}
                            />
                        )}
                        {chat.error && <Alert className="mx-3 mb-2">{chat.error}</Alert>}
                        {chat.notice && <Alert tone="info" className="mx-3 mb-2">{chat.notice}</Alert>}
                        <form onSubmit={submit} className="space-y-2 border-t border-line p-3">
                            <Field
                                label={t("ai.composer.label")}
                                hint={promptTooLarge ? undefined : waiting ? t("ai.composer.waiting") : t("ai.composer.hint")}
                                error={promptTooLarge ? t("ai.composer.tooLarge") : undefined}
                            >
                                {(control) => (
                                    <Textarea
                                        {...control}
                                        rows={3}
                                        className="max-h-48 resize-y"
                                        value={draft}
                                        disabled={busy || waiting || !chat.historyReady}
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
                                    icon={<SendIcon/>}
                                    disabled={busy || waiting || !chat.historyReady || !draft.trim() || promptTooLarge}
                                >
                                    {t("ai.composer.send")}
                                </Button>
                            </div>
                        </form>
                    </section>
                </div>
            )}

            <Dialog
                open={ready && Boolean(dialog)}
                title={dialog === "rename" ? t("ai.dialog.renameTitle") : t("ai.dialog.deleteTitle")}
                onClose={() => {
                    if (!busy) setDialog("");
                }}
                footer={
                    <>
                        <Button disabled={busy} onClick={() => setDialog("")}>
                            {t("ai.dialog.cancel")}
                        </Button>
                        <Button
                            variant={dialog === "delete" ? "delete" : "secondary"}
                            disabled={busy || (dialog === "rename" && !title.trim())}
                            onClick={confirmDialog}
                        >
                            {dialog === "rename" ? t("ai.dialog.save") : t("ai.dialog.confirmDelete")}
                        </Button>
                    </>
                }
            >
                {dialog === "rename" ? (
                    <Field label={t("ai.dialog.titleLabel")} hint={t("ai.dialog.titleHint")}>
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
                    <p>{t("ai.dialog.deleteText")}</p>
                )}
                {chat.error && <Alert>{chat.error}</Alert>}
            </Dialog>
        </div>
    );
};

export default AiChat;
