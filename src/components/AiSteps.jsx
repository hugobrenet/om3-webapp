import {useEffect, useId, useState} from "react";
import {useTranslation} from "react-i18next";
import {CrossLink} from "../app/CrossLink";
import {AGENT_TOOLS} from "../services/ai-agent.js";
import {StateGlyph} from "../ui/components/StateGlyph";
import {Spinner} from "../ui/components/Spinner";
import {ChevronDownIcon} from "../ui/icons";
import {cn} from "../ui/cn";
import {untrustedT} from "../utils/untrustedText";

/**
 * A duration in milliseconds, as the frise says it: 5 ms, 1.2 s, 12 s,
 * 1 min 05 s. A read of the MCP takes a few milliseconds: below a second,
 * the milliseconds, or every step would read 0 s.
 */
export function formatDuration(ms, language) {
    if (!Number.isFinite(ms) || ms < 0) return "";
    if (ms < 1000) return `${new Intl.NumberFormat(language).format(Math.round(ms))} ms`;
    if (ms < 60000) {
        const seconds = new Intl.NumberFormat(language, {maximumFractionDigits: ms < 10000 ? 1 : 0}).format(ms / 1000);
        return `${seconds} s`;
    }
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
}

/** A live timer, mm:ss. */
const clock = (ms) => {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

/** The duration of a step, null while it has no start or no end. */
const stepDuration = (step) =>
    Number.isFinite(step.startedAt) && Number.isFinite(step.endedAt) && step.endedAt >= step.startedAt ? step.endedAt - step.startedAt : null;

/** The duration of an answer: its runs, on the clock of the agent, the waits for a decision left out. */
export const answerDuration = (message) =>
    (message.runs || []).reduce(
        (total, run) => (Number.isFinite(run.startedAt) && Number.isFinite(run.endedAt) && run.endedAt >= run.startedAt ? total + run.endedAt - run.startedAt : total),
        0
    );

/** An argument as a sentence names it: a string, or a list of strings joined. */
const paramOf = (value) => {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value) && value.length && value.every((item) => typeof item === "string")) return value.join(", ");
    return undefined;
};

/** The name of a tool made readable: get_object_status, "Get object status". */
const readableName = (tool) => {
    const words = tool.replace(/_/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * The sentence of a step: its own, ai.step.<tool>, else the sentence of the
 * confirmation of an action, filled with its arguments, untrusted, put in
 * one pass; the name of its tool made readable when it has none, or when an
 * argument it names is missing.
 */
export function stepSentence(step, t, i18n) {
    for (const name of [`ai.step.${step.tool}`, `ai.confirm.summary.${step.tool}`]) {
        if (!i18n.exists(name)) continue;
        const template = String(i18n.getResource(i18n.resolvedLanguage ?? i18n.language, "translation", name) ?? i18n.getResource("en", "translation", name) ?? "");
        const named = [...template.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]);
        const params = Object.fromEntries(named.map((param) => [param, paramOf(step.arguments?.[param])]));
        if (named.some((param) => params[param] === undefined)) break;
        return untrustedT(t, name, params);
    }
    return readableName(step.tool);
}

/** The state of an object as its glyph draws it. */
const glyphOf = (status) => {
    const avail = status?.avail;
    if (["up", "down", "warn"].includes(avail)) return avail;
    if (avail === "n/a") return "na";
    return "unknown";
};
const GLYPH_INK = {up: "text-state-up", down: "text-state-down", warn: "text-state-warn", na: "text-state-unknown", unknown: "text-state-unknown"};

/**
 * The badge of an object or a node a step or the answer names, only when the
 * cluster holds it: a name the model made up stays text. It carries the state;
 * its panel tells the rest.
 */
export function TargetBadge({kind, id, status}) {
    const {t} = useTranslation();
    if (kind === "object") {
        const object = status?.objects?.[id];
        if (!object) return <code>{id}</code>;
        const glyph = glyphOf(object);
        return (
            <CrossLink kind="object" id={id}>
                <span className={cn("inline-flex items-center gap-1", GLYPH_INK[glyph])}>
                    <StateGlyph state={glyph} className="h-2 w-2"/>
                    <span className="sr-only">{t(`ai.steps.states.${glyph}`)}</span>
                </span>
                <span className="text-ink">{id}</span>
            </CrossLink>
        );
    }
    if (!status?.nodeStatus?.[id]) return <code>{id}</code>;
    return <CrossLink kind="node" id={id}>{id}</CrossLink>;
}

const STATUS_INK = {
    running: "text-ink-muted",
    pending: "text-state-warn",
    completed: "text-state-up",
    failed: "text-state-down",
    rejected: "text-state-warn",
    interrupted: "text-state-unknown",
};

/** The mark of the status of a step, drawn, its name for screen readers. */
function StepStatus({status}) {
    const {t} = useTranslation();
    if (status === "running") return <Spinner label={t("ai.steps.status.running")}/>;
    const glyph = {completed: "up", failed: "down", rejected: "warn", pending: "warn", interrupted: "na"}[status] || "unknown";
    return (
        <span className={cn("inline-flex w-3 justify-center", STATUS_INK[status])}>
            <StateGlyph state={glyph} className="h-2 w-2"/>
            <span className="sr-only">{t(`ai.steps.status.${status}`)}</span>
        </span>
    );
}

/** One step of the frise: its status, its sentence, its targets, its duration; its details on demand. */
function Step({step, status, parallel}) {
    const {t, i18n} = useTranslation();
    const [open, setOpen] = useState(false);
    const detailsId = useId();
    const agent = AGENT_TOOLS.has(step.tool);
    const duration = stepDuration(step);
    const path = paramOf(step.arguments?.path);
    const node = paramOf(step.arguments?.node);
    return (
        <li className={cn("text-data", agent && "text-ink-muted")}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <StepStatus status={step.status}/>
                <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={detailsId}
                    onClick={() => setOpen(!open)}
                    className="min-w-0 text-left [overflow-wrap:anywhere] hover:underline"
                >
                    {stepSentence(step, t, i18n)}
                </button>
                {!agent && path && <TargetBadge kind="object" id={path} status={status}/>}
                {!agent && node && <TargetBadge kind="node" id={node} status={status}/>}
                {parallel && <span className="text-ink-muted">{t("ai.steps.parallel")}</span>}
                {step.editedArgs && <span className="text-ink-muted">{t("ai.message.withChanges")}</span>}
                {duration !== null && <span className="ml-auto text-ink-muted tabular-nums">{formatDuration(duration, i18n.language)}</span>}
            </div>
            <div id={detailsId} hidden={!open} className="mt-1 ml-5 space-y-1">
                <p className="text-ink-muted">
                    <code>{step.tool}</code> · {t(`ai.steps.status.${step.status}`)}
                </p>
                {step.arguments && Object.keys(step.arguments).length > 0 && (
                    <pre aria-label={t("ai.steps.arguments")} className="max-h-48 overflow-auto rounded-(--radius-control) bg-surface-sunken p-2 font-mono whitespace-pre-wrap [overflow-wrap:anywhere]">
                        {JSON.stringify(step.arguments, null, 2)}
                    </pre>
                )}
                {!step.arguments && step.argumentsOmitted && <p className="text-ink-muted">{t("ai.steps.argumentsOmitted")}</p>}
                {step.refusal && (
                    <div>
                        <p className="font-medium text-state-down">{t("ai.steps.refusal")}</p>
                        <pre className="max-h-48 overflow-auto rounded-(--radius-control) bg-state-down-soft p-2 font-mono whitespace-pre-wrap [overflow-wrap:anywhere]">{step.refusal}</pre>
                    </div>
                )}
                {step.result_excerpt && (
                    <div>
                        <p className="text-ink-muted">{step.result_truncated ? t("ai.steps.excerptTruncated") : t("ai.steps.excerpt")}</p>
                        <pre className="max-h-48 overflow-auto rounded-(--radius-control) bg-surface-sunken p-2 font-mono whitespace-pre-wrap [overflow-wrap:anywhere]">{step.result_excerpt}</pre>
                    </div>
                )}
            </div>
        </li>
    );
}

/**
 * The steps of an answer, folded in one line, its live timer while it runs:
 * the time counted on the clock of the page since the run started, the
 * durations shown from the clock of the agent. Unfolded, the steps in the
 * order they started, the time of the model between them, the ones that ran
 * at once said so.
 */
export function AiSteps({message, status}) {
    const {t, i18n} = useTranslation();
    const [open, setOpen] = useState(false);
    const listId = useId();
    const [now, setNow] = useState(() => Date.now());
    const live = Number.isFinite(message.liveSince);
    useEffect(() => {
        if (!live) return undefined;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [live]);
    const steps = message.steps || [];
    // Sent, the run not started yet: the page shows it is waiting.
    if (!steps.length && !live) return message.status === "running" ? <Spinner label={t("ai.steps.waiting")} className="text-data"/> : null;
    // In the order they started when all have a start; as served otherwise,
    // such as the steps of a turn stored before the times were.
    const timed = steps.every((step) => Number.isFinite(step.startedAt));
    const ordered = timed ? [...steps].sort((left, right) => left.startedAt - right.startedAt) : steps;
    const current = steps.find((step) => step.status === "running");
    const summary = live
        ? untrustedT(t, "ai.steps.running", {time: clock(now - message.liveSince)})
        : t("ai.steps.summary", {count: steps.length, duration: formatDuration(answerDuration(message), i18n.language)});
    // The time of the model before a step: since the end of the steps before
    // it, or the start of its run.
    const rows = [];
    let lastEnd = null;
    ordered.forEach((step, index) => {
        const runStart = (message.runs || []).filter((run) => Number.isFinite(run.startedAt) && run.startedAt <= step.startedAt).at(-1)?.startedAt;
        const since = lastEnd !== null && runStart !== undefined ? Math.max(lastEnd, runStart) : lastEnd ?? runStart;
        const parallel = index > 0 && Number.isFinite(step.startedAt) && lastEnd !== null && step.startedAt < lastEnd;
        if (Number.isFinite(step.startedAt) && since !== undefined && since !== null && step.startedAt - since >= 100 && !parallel)
            rows.push(<li key={`model-${step.id}`} className="ml-5 text-data text-ink-muted">{t("ai.steps.model", {duration: formatDuration(step.startedAt - since, i18n.language)})}</li>);
        rows.push(<Step key={step.id} step={step} status={status} parallel={parallel}/>);
        if (Number.isFinite(step.endedAt)) lastEnd = Math.max(lastEnd ?? step.endedAt, step.endedAt);
    });
    return (
        <div className="my-1">
            <button
                type="button"
                aria-expanded={open}
                aria-controls={listId}
                onClick={() => setOpen(!open)}
                className="inline-flex items-center gap-1 text-data text-ink-muted hover:text-ink"
            >
                <ChevronDownIcon width={12} height={12} className={cn("transition-transform", !open && "-rotate-90")}/>
                {summary}
            </button>
            {live && current && !open && (
                <p className="ml-4 text-data text-ink-muted [overflow-wrap:anywhere]">{stepSentence(current, t, i18n)}</p>
            )}
            <ol id={listId} hidden={!open} aria-label={t("ai.steps.label")} className="mt-1 space-y-1 border-l border-line pl-3">
                {rows}
            </ol>
        </div>
    );
}

/** The foot of an answer: its duration, its steps, its tokens, and the actions the user rejected. */
export function AnswerFooter({message}) {
    const {t, i18n} = useTranslation();
    const steps = message.steps || [];
    const rejected = steps.filter((step) => step.status === "rejected").length;
    const parts = [];
    const duration = answerDuration(message);
    if (duration > 0) parts.push(formatDuration(duration, i18n.language));
    if (steps.length) parts.push(t("ai.steps.count", {count: steps.length}));
    if (typeof message.usage?.total_tokens === "number") parts.push(t("ai.message.tokens", {total: message.usage.total_tokens}));
    if (rejected) parts.push(t("ai.steps.rejected", {count: rejected}));
    if (!parts.length) return null;
    return <p className="mt-1 text-data text-ink-muted">{parts.join(" · ")}</p>;
}
