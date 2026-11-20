import React, {useCallback, useEffect, useId, useMemo, useRef, useState} from "react";
import {useTranslation} from "react-i18next";
import {URL_NODE} from "../config/apiPath.js";
import {getResponseErrorMessage} from "../services/api.jsx";
import {useIsRoot} from "../hooks/useGrants";
import {useFollowScroll} from "../hooks/useFollowScroll";
import {
    AUDIT_LEVELS,
    AUDIT_PREEMPTED,
    auditRecordOf,
    auditText,
    auditUrl,
    eventStreamParser,
    parseSubsystems,
    subsystemSuggestions,
} from "../app/daemon-audit";
import useEventStore from "../hooks/useEventStore.js";
import {Alert} from "../ui/components/Alert";
import {Spinner} from "../ui/components/Spinner";
import {Button, IconButton} from "../ui/components/Button";
import {Input, Select} from "../ui/components/Field";
import {FollowOverlay} from "../ui/components/FollowOverlay";
import {StatusMark} from "../ui/components/StatusMark";
import {CloseIcon, DownloadIcon, PlayIcon, SearchIcon, StopIcon, TrashIcon} from "../ui/icons";
import {cn} from "../ui/cn";
import {authHeaders} from "./NodePanel";

/** The records kept: the oldest go past them, as a terminal scrolls them away. */
const MAX_RECORDS = 5000;

/** A level in a state colour, its name doubling the colour, as in the logs. */
const levelClass = (level) => (
    level === "error" || level === "fatal" || level === "panic" ? "text-state-down"
        : level === "warn" ? "text-state-warn"
            : level === "debug" || level === "trace" ? "text-ink-muted"
                : "text-ink"
);

/**
 * The subsystems of an audit, a chip each, typed with suggestions: the known names
 * containing what is typed, those taking a suffix completed in the field ("imon:"),
 * then "imon:*" and the object paths of the cluster. Enter, a comma or a blank adds
 * what is typed, a pattern of its own when no suggestion is picked; Backspace in the
 * empty field takes the last chip back. None, all of them.
 */
function SubsystemField({labelId, value, onChange, disabled}) {
    const {t} = useTranslation();
    const listId = useId();
    const [text, setText] = useState("");
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const objects = useEventStore((s) => s.objectStatus);
    const paths = useMemo(() => Object.keys(objects ?? {}), [objects]);
    const suggestions = useMemo(() => subsystemSuggestions(text, value, paths), [text, value, paths]);
    const shown = open && !disabled && suggestions.length > 0;
    const current = shown && active >= 0 && active < suggestions.length ? suggestions[active] : undefined;

    const add = (patterns) => {
        const fresh = patterns.filter((p) => !value.includes(p));
        if (fresh.length > 0) onChange([...value, ...fresh]);
        setText("");
        setActive(-1);
    };
    const pick = (suggestion) => {
        if (suggestion.partial) {
            // Its suffix to write: the paths suggested next.
            setText(suggestion.value);
            setActive(-1);
        } else add([suggestion.value]);
    };
    const remove = (pattern) => onChange(value.filter((p) => p !== pattern));

    return (
        <div className="relative">
            <div
                className={cn(
                    "flex min-h-8 flex-wrap items-center gap-1 rounded-(--radius-control) border border-line bg-surface px-1 py-0.5 focus-within:border-accent",
                    disabled && "opacity-60"
                )}
            >
                {value.map((pattern) => (
                    <span key={pattern} className="inline-flex h-6 items-center gap-1 rounded-full border border-line bg-surface-sunken pr-0.5 pl-2 font-mono text-data">
                        {pattern}
                        {/* The cross inside the chip, a round of its own: no border on the chip's. */}
                        <IconButton
                            size="sm"
                            className="h-[1.125rem] w-[1.125rem] rounded-full border-0 pointer-coarse:h-5 pointer-coarse:w-5"
                            label={t("nodeDaemon.audit.remove", {subsystem: pattern})}
                            disabled={disabled}
                            onClick={() => remove(pattern)}
                        >
                            <CloseIcon className="h-3 w-3"/>
                        </IconButton>
                    </span>
                ))}
                <input
                    type="text"
                    role="combobox"
                    aria-labelledby={labelId}
                    aria-expanded={shown}
                    aria-controls={listId}
                    aria-autocomplete="list"
                    aria-activedescendant={current ? `${listId}-${active}` : undefined}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={disabled}
                    placeholder={value.length === 0 ? t("nodeDaemon.audit.subsystemsPlaceholder") : ""}
                    className="h-7 min-w-[8rem] flex-1 bg-transparent px-1 font-mono text-data outline-none"
                    value={text}
                    onFocus={() => setOpen(true)}
                    // Left with a pattern typed: kept, not lost.
                    onBlur={() => {
                        setOpen(false);
                        if (text.trim() !== "") add(parseSubsystems(text));
                    }}
                    onChange={(e) => {
                        const typed = e.target.value;
                        // Pasted or typed past a separator: the patterns before it added.
                        if (/[\s,]/.test(typed)) {
                            const parts = typed.split(/[\s,]+/);
                            const rest = parts.pop() ?? "";
                            const done = parts.filter(Boolean);
                            if (done.length > 0) onChange([...value, ...done.filter((p) => !value.includes(p))]);
                            setText(rest);
                        } else setText(typed);
                        setActive(-1);
                        setOpen(true);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                            e.preventDefault();
                            setOpen(true);
                            const step = e.key === "ArrowDown" ? 1 : -1;
                            const count = suggestions.length;
                            if (count > 0) setActive((i) => (i < 0 ? (step > 0 ? 0 : count - 1) : (i + step + count) % count));
                        } else if (e.key === "Enter") {
                            e.preventDefault();
                            if (current) pick(current);
                            else if (text.trim() !== "") add(parseSubsystems(text));
                        } else if (e.key === "Escape" && shown) {
                            // The list closed, not the panel.
                            e.stopPropagation();
                            setOpen(false);
                        } else if (e.key === "Backspace" && text === "" && value.length > 0) {
                            remove(value[value.length - 1]);
                        }
                    }}
                />
            </div>
            {shown && (
                <ul
                    id={listId}
                    role="listbox"
                    aria-labelledby={labelId}
                    className="absolute left-0 right-0 z-10 mt-1 max-h-64 overflow-auto rounded-(--radius-control) border border-line bg-surface-raised py-1 font-mono text-data shadow-lg"
                >
                    {suggestions.map((s, i) => (
                        <li
                            key={s.value}
                            id={`${listId}-${i}`}
                            role="option"
                            aria-selected={i === active}
                            className={cn("flex cursor-pointer items-baseline gap-2 px-2 py-0.5", i === active && "bg-accent-soft")}
                            // Picked without the field losing its focus.
                            onMouseDown={(e) => e.preventDefault()}
                            onMouseEnter={() => setActive(i)}
                            onClick={() => pick(s)}
                        >
                            {s.value}
                            {s.partial && <span className="font-sans text-ink-muted">{t(`nodeDaemon.audit.suffix.${s.value.slice(0, -1)}`)}</span>}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/**
 * The audit of the daemon of a node, as `om daemon audit` reads it: the log records
 * of the subsystems named, all of them when none is, from the level chosen, streamed
 * from Start to Stop. Root only. One audit at a time on a daemon: refused while
 * another runs, which a Take over preempts; preempted, said, not opened again. The
 * audit stops as the view is left, the daemon logging no more than it needs to.
 */
export function DaemonAudit({node}) {
    const {t, i18n} = useTranslation();
    const isRoot = useIsRoot();
    const [level, setLevel] = useState("debug");
    const [subsystems, setSubsystems] = useState([]);
    const subsLabelId = useId();
    // idle, starting, running, then ended, stopped, preempted, conflict, refused or failed.
    const [phase, setPhase] = useState("idle");
    const [detail, setDetail] = useState("");
    const [records, setRecords] = useState([]);
    const [search, setSearch] = useState("");
    const controllerRef = useRef(null);
    const containerRef = useRef(null);
    const active = phase === "starting" || phase === "running";

    const shown = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return needle === "" ? records : records.filter((r) => `${r.level} ${r.message}`.toLowerCase().includes(needle));
    }, [records, search]);
    const {following, follow, newCount, countNew, handleScroll, toEnd, scrollAge} = useFollowScroll({
        containerRef,
        items: shown,
        lineSelector: ".audit-line",
        locale: i18n.language,
    });

    // Left, another node: the audit stopped.
    useEffect(() => () => controllerRef.current?.abort(), [node]);

    const start = useCallback(async (preempt = false) => {
        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;
        const current = () => controllerRef.current === controller;
        setPhase("starting");
        setDetail("");
        setRecords([]);
        follow(true);
        let nextId = 0;
        try {
            const response = await fetch(auditUrl(URL_NODE, node, {level, subsystems, preempt}), {
                method: "POST",
                headers: {...authHeaders(), Accept: "text/event-stream"},
                signal: controller.signal,
            });
            if (!current()) return;
            if (!response.ok) {
                setDetail(await getResponseErrorMessage(response));
                setPhase(response.status === 409 ? "conflict" : "refused");
                return;
            }
            if (!response.body) {
                setPhase("failed");
                return;
            }
            setPhase("running");
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            const parse = eventStreamParser();
            let preempted = false;
            while (!preempted) {
                const {value, done} = await reader.read();
                if (done || !current()) break;
                const fresh = [];
                for (const {event, data} of parse(decoder.decode(value, {stream: true}))) {
                    const record = auditRecordOf(data, node, nextId++);
                    if (record) fresh.push(record);
                    if (event === AUDIT_PREEMPTED) preempted = true;
                }
                if (fresh.length > 0) {
                    countNew(fresh.length);
                    setRecords((previous) => [...previous, ...fresh].slice(-MAX_RECORDS));
                }
            }
            reader.cancel?.().catch(() => {});
            if (current()) setPhase(preempted ? "preempted" : "ended");
        } catch (error) {
            if (error?.name === "AbortError" || !current()) return;
            setDetail(error.message);
            setPhase("failed");
        }
    }, [node, level, subsystems, follow, countNew]);

    const stop = () => {
        controllerRef.current?.abort();
        controllerRef.current = null;
        setPhase("stopped");
    };

    const download = () => {
        const url = URL.createObjectURL(new Blob([auditText(shown)], {type: "text/plain"}));
        const a = document.createElement("a");
        a.href = url;
        a.download = `${node}-daemon-audit-${new Date().toISOString()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const formatTime = (time) => time.toLocaleTimeString(i18n.language, {
        hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3,
    });

    // The grants not read yet: nothing said of who may audit.
    if (isRoot === undefined) {
        return <div className="flex justify-center p-4"><Spinner label={t("nodeDaemon.audit.grantsLoading")}/></div>;
    }
    if (!isRoot) {
        return <Alert tone="info">{t("nodeDaemon.audit.rootOnly")}</Alert>;
    }

    const what = subsystems.length === 0 ? t("nodeDaemon.audit.allSubsystems") : subsystems.join(", ");

    return (
        <div className="flex flex-col gap-3">
            <p className="text-ink-muted">{t("nodeDaemon.audit.intro")}</p>

            <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                    <span className="font-medium">{t("nodeDaemon.audit.level")}</span>
                    <Select value={level} disabled={active} onChange={(e) => setLevel(e.target.value)}>
                        {AUDIT_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                    </Select>
                </label>
                <div className="flex min-w-[14rem] flex-1 flex-col gap-1">
                    <span id={subsLabelId} className="font-medium">{t("nodeDaemon.audit.subsystems")}</span>
                    <SubsystemField labelId={subsLabelId} value={subsystems} onChange={setSubsystems} disabled={active}/>
                </div>
                {active ? (
                    <Button variant="change" icon={<StopIcon className="h-3.5 w-3.5"/>} onClick={stop}>
                        {t("nodeDaemon.audit.stop")}
                    </Button>
                ) : (
                    <Button variant="change" icon={<PlayIcon className="h-3.5 w-3.5"/>} onClick={() => start(false)}>
                        {t("nodeDaemon.audit.start")}
                    </Button>
                )}
            </div>
            <p className="text-data text-ink-muted">{t("nodeDaemon.audit.suffixHint")}</p>

            {phase === "running" && (
                <p role="status" className="inline-flex items-center gap-1.5">
                    <StatusMark state="up" label={t("nodeDaemon.audit.running")}/>
                    {t("nodeDaemon.audit.runningOf", {subsystems: what, level})}
                </p>
            )}
            {phase === "conflict" && (
                <Alert
                    tone="warning"
                    action={<Button size="sm" onClick={() => start(true)}>{t("nodeDaemon.audit.takeOver")}</Button>}
                >
                    {t("nodeDaemon.audit.conflict", {detail})}
                </Alert>
            )}
            {phase === "preempted" && <Alert tone="warning">{t("nodeDaemon.audit.preempted")}</Alert>}
            {phase === "ended" && <Alert tone="info">{t("nodeDaemon.audit.ended")}</Alert>}
            {(phase === "refused" || phase === "failed") && (
                <Alert tone="error">{t("nodeDaemon.audit.failed", {detail: detail || t("nodeDaemon.audit.noStream")})}</Alert>
            )}

            <div className="flex flex-wrap items-center gap-3">
                <label className="flex min-w-[200px] flex-1 items-center gap-1 text-ink-muted">
                    <SearchIcon className="shrink-0"/>
                    <span className="sr-only">{t("common.search")}</span>
                    <Input
                        className="h-7"
                        placeholder={t("nodeDaemon.audit.search")}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </label>
                <span className="text-data text-ink-muted">
                    {t("logs.count", {shown: shown.length, total: records.length})}
                </span>
                <Button size="sm" aria-pressed={following} onClick={() => (following ? follow(false) : toEnd())}>
                    {following ? t("logs.following") : t("logs.follow")}
                </Button>
                <IconButton label={t("logs.clear")} onClick={() => setRecords([])} disabled={records.length === 0}>
                    <TrashIcon/>
                </IconButton>
                <IconButton label={t("logs.download")} onClick={download} disabled={shown.length === 0}>
                    <DownloadIcon/>
                </IconButton>
            </div>

            <div className="relative flex min-h-0 flex-col">
                <div
                    ref={containerRef}
                    onScroll={handleScroll}
                    role="log"
                    aria-live="off"
                    aria-label={t("nodeDaemon.audit.lines")}
                    tabIndex={0}
                    className="h-[28rem] min-h-0 overflow-auto rounded-(--radius-control) border border-line py-1 font-mono text-data"
                >
                    {shown.length === 0 ? (
                        <p className="pt-4 text-center font-sans text-ink-muted">
                            {records.length === 0 ? t("nodeDaemon.audit.empty") : t("logs.noMatch")}
                        </p>
                    ) : (
                        <div className="grid gap-x-2" style={{gridTemplateColumns: "max-content max-content minmax(0, 1fr)"}}>
                            {shown.map((r) => (
                                <div
                                    key={r.id}
                                    id={`audit-${node}-${r.id}`}
                                    data-at={r.time.getTime()}
                                    className="audit-line col-span-full grid grid-cols-subgrid items-baseline border-b border-line/40 px-2 py-0.5 max-md:flex max-md:flex-wrap max-md:gap-x-2"
                                >
                                    <span className="text-ink-muted">{formatTime(r.time)}</span>
                                    <span className={levelClass(r.level)}>{r.level.toUpperCase()}</span>
                                    <span className="min-w-0 max-md:basis-full">
                                        {r.prefixes.map((prefix, j) => (
                                            <span
                                                key={`${j}-${prefix}`}
                                                className="mr-1 rounded-full border border-line/60 px-1.5 font-sans text-[0.6875rem] leading-4 text-ink-muted"
                                            >
                                                {prefix}
                                            </span>
                                        ))}
                                        <span className="break-words whitespace-pre-wrap" data-text="">{r.text}</span>
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <FollowOverlay
                    scrollAge={scrollAge}
                    following={following}
                    shown={shown.length > 0}
                    onEnd={toEnd}
                    label={newCount > 0 ? t("logs.newLines", {count: newCount}) : t("logs.latest")}
                />
            </div>
        </div>
    );
}
