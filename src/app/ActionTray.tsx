import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { actionLabel } from "../constants/actions";
import { cn } from "../ui/cn";
import { AlertTriangleIcon, BanIcon, BoltIcon, CheckIcon, CloseIcon, FileIcon, TrashIcon } from "../ui/icons";
import { Button } from "../ui/components/Button";
import { Dialog } from "../ui/components/Dialog";
import { DaemonIdLogs } from "../components/DaemonIdLogs";
import AskAssistantLink from "../components/AskAssistantLink";
import { untrustedT } from "../utils/untrustedText";
import { MAX_LINK_PROMPT } from "../config/ai-agent.js";
import useEventStore from "../hooks/useEventStore.js";
import { type TrackState, type TrackStep, type Tracked, useActionTracker } from "./action-tracker";

/*
 * The actions asked, as they go: a button of the header, whatever the view, its
 * mark turning while one runs, which opens them in a dialog. Each says there where
 * it stands, how long it took, why it failed, and, for an orchestration, the run
 * of each node it made. A success leaves on its own after a while; a failure stays
 * until dismissed, or until the ended are cleared, from the dialog.
 */

/** A duration said short: 0.4 s, 12 s, 3 min 05 s. */
export function formatDuration(ms: number): string {
  if (ms < 10_000) return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${String(seconds)} s`;
  return `${String(Math.floor(seconds / 60))} min ${String(seconds % 60).padStart(2, "0")} s`;
}

const since = (start: string | undefined, end: string | undefined, now: number) => {
  if (start === undefined) return null;
  const from = Date.parse(start);
  const to = end === undefined ? now : Date.parse(end);
  return Number.isNaN(from) || Number.isNaN(to) ? null : to - from;
};

function StateMark({ state, label }: { state: TrackState; label: string }) {
  const icon = (() => {
    switch (state) {
      case "running":
        return <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-accent" />;
      case "succeeded":
        return <CheckIcon className="h-3.5 w-3.5 text-state-up" />;
      case "aborted":
        return <BanIcon className="h-3.5 w-3.5 text-state-warn" />;
      case "failed":
      case "refused":
        return <AlertTriangleIcon className="h-3.5 w-3.5 text-state-down" />;
      default:
        return <span className="font-semibold text-ink-muted">?</span>;
    }
  })();
  return (
    <span role="img" aria-label={label} className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
      <span aria-hidden="true" className="inline-flex">
        {icon}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function Step({ step, now }: { step: TrackStep; now: number }) {
  const { t } = useTranslation();
  const took = since(step.startedAt, step.endedAt, now);
  const failure = [step.error, step.exitCode !== undefined && step.exitCode !== 0 ? t("actionTray.exitCode", { code: step.exitCode }) : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="flex flex-col gap-0.5">
      <span className="flex items-center gap-2">
        <StateMark state={step.state} label={t(`actionTray.states.${step.state}`)} />
        <span className="rounded-(--radius-control) bg-surface-sunken px-1 text-[0.75rem] text-ink-muted">{step.node}</span>
        <span className="min-w-0 flex-1 truncate">
          {step.title}
        </span>
        {took !== null && <span className="shrink-0 text-ink-muted tabular-nums">{formatDuration(took)}</span>}
      </span>
      {failure && step.state !== "succeeded" && <span className="pl-6 text-state-down">{failure}</span>}
    </li>
  );
}

/**
 * Where the instances of an object stand, by their monitors, while its orchestration
 * runs nothing yet on them: the delays the daemon keeps (ready, wait parents...)
 * said, rather than a wait unexplained. Said as a string for the selector to hold
 * still while nothing changes.
 */
function useMonitorStates(path: string | undefined, active: boolean): [string, string][] {
  const states = useEventStore((s: { instanceMonitor?: Record<string, { state?: string }> }) =>
    !active || path === undefined
      ? ""
      : Object.entries(s.instanceMonitor ?? {})
          .filter(([key]) => key.endsWith(`:${path}`))
          .map(([key, monitor]) => `${key.slice(0, key.indexOf(":"))}=${monitor.state ?? ""}`)
          .sort()
          .join(","),
  );
  if (states === "") return [];
  return states
    .split(",")
    .map((pair) => pair.split("=") as [string, string])
    .filter(([, state]) => state !== "" && state !== "idle");
}

/** The longest error a question to the assistant quotes: the logs tell the rest. */
const MAX_ASKED_ERROR = 200;

/**
 * The question to the assistant about an action failed, or refused: the daemon
 * declined it, nothing ran, there is no run to look into. What, on what, then
 * what is known only: the node answering for it, the id its logs, or its refusal,
 * are recorded under, and the error said, last, cut to what the bound of a link
 * leaves it (MAX_LINK_PROMPT), the sentence kept whole. Every value goes as it
 * is, never read as a placeholder.
 */
export function failedActionQuestion(t: (key: string, options?: Record<string, unknown>) => string, entry: Tracked): string {
  const refused = entry.state === "refused";
  const parts = [
    untrustedT(t, refused ? "ai.askAbout.refusedAction" : "ai.askAbout.failedAction", {
      action: entry.label ?? actionLabel(entry.action),
      subject: entry.subject,
    }),
  ];
  if (entry.node !== "") parts.push(untrustedT(t, "ai.askAbout.actionNode", { node: entry.node }));
  if (entry.followedId !== undefined) parts.push(untrustedT(t, "ai.askAbout.actionId", { kind: entry.kind, id: entry.followedId }));
  const error = entry.error !== undefined && entry.error !== "gone" && entry.error !== "queued" ? entry.error.trim() : "";
  if (error !== "") {
    const key = refused ? "ai.askAbout.actionReason" : "ai.askAbout.actionError";
    const room = MAX_LINK_PROMPT - parts.join(" ").length - 1 - untrustedT(t, key, { error: "" }).length;
    const length = Math.min(MAX_ASKED_ERROR, room);
    // Too little room left, no error rather than a few letters of it.
    if (length >= 20) parts.push(untrustedT(t, key, { error: error.length > length ? `${error.slice(0, length - 1)}…` : error }));
  }
  return parts.join(" ");
}

/** `onLeave`, called as a link of the entry leaves for another page: the dialog closes. */
function Entry({ entry, now, onLeave }: { entry: Tracked; now: number; onLeave: () => void }) {
  const { t } = useTranslation();
  const dismiss = useActionTracker((s) => s.dismiss);
  // Its logs in a modal: an orchestration's on every node, an exec's on its node.
  const [logs, setLogs] = useState(false);
  const action = entry.label ?? actionLabel(entry.action);
  const took = (entry.endedAt ?? now) - entry.startedAt;
  const state = t(`actionTray.states.${entry.state}`);
  const waiting = entry.state === "running" && entry.kind === "orchestration";
  // Aborted, its runs already under way went on to their end (an abort stops what the
  // orchestration has yet to do, not a start or a stop running): said, the action done
  // all the same rather than read as never done.
  const ranOn = entry.state === "aborted" ? [...new Set(entry.steps.filter((step) => step.state !== "aborted").map((step) => step.node))] : [];
  // The nodes with no run of it yet, where their monitor stands.
  const monitors = useMonitorStates(entry.path, waiting).filter(
    ([node]) => !entry.steps.some((step) => step.node === node && step.state === "running"),
  );
  return (
    <li className="space-y-1 px-3 py-2" data-state={entry.state}>
      <div className="flex items-start gap-2">
        <span className="pt-0.5">
          <StateMark state={entry.state} label={state} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate">
            <span className="font-semibold">{action}</span> <span className="text-ink-muted">{entry.subject}</span>
          </p>
          <p
            className={cn(
              "text-data",
              entry.state === "failed" || entry.state === "refused" ? "text-state-down" : ranOn.length > 0 ? "text-state-warn" : "text-ink-muted",
            )}
          >
            {state}
            {entry.state === "running" &&
              entry.kind === "orchestration" &&
              ` · ${t(entry.queued ? "actionTray.queuedOn" : "actionTray.acceptedBy", { node: entry.node })}`}
            {entry.error && entry.error !== "gone" && entry.error !== "queued" && ` · ${entry.error}`}
            {entry.error === "gone" && ` · ${t("actionTray.gone")}`}
            {entry.error === "queued" && ` · ${t("actionTray.neverTakenOn", { node: entry.node })}`}
            {ranOn.length > 0 && ` · ${t("actionTray.ranAnyway", { count: ranOn.length, nodes: ranOn.join(", ") })}`}
          </p>
        </div>
        <span className="shrink-0 pt-0.5 text-data text-ink-muted tabular-nums">{formatDuration(took)}</span>
        {(entry.state === "failed" || entry.state === "refused") && (
          <AskAssistantLink prompt={failedActionQuestion(t, entry)} onClick={onLeave} />
        )}
        {entry.followedId !== undefined && (
          <button
            type="button"
            onClick={() => {
              setLogs(true);
            }}
            className="shrink-0 rounded-full p-1 text-ink-muted hover:text-ink"
          >
            <FileIcon className="h-3 w-3" />
            <span className="sr-only">{t("actionTray.logs", { action, subject: entry.subject })}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            dismiss(entry.id);
          }}
          className="shrink-0 rounded-full p-1 text-ink-muted hover:text-ink"
        >
          <CloseIcon className="h-3 w-3" />
          <span className="sr-only">{t("actionTray.dismiss", { action, subject: entry.subject })}</span>
        </button>
      </div>
      {entry.warnings !== undefined && entry.warnings.length > 0 && (
        <ul aria-label={t("actionTray.warnings", { action })} className="space-y-1 pl-6 text-data text-state-warn">
          {entry.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      {(entry.steps.length > 0 || monitors.length > 0) && (
        <ul aria-label={t("actionTray.steps", { action })} className="space-y-1 pl-6 text-data">
          {entry.steps.map((step) => (
            <Step key={step.execId} step={step} now={now} />
          ))}
          {monitors.map(([node, monitor]) => (
            <li key={`monitor-${node}`} className="flex items-center gap-2 text-ink-muted">
              <StateMark state="running" label={t("actionTray.monitor", { node, state: monitor })} />
              <span className="rounded-(--radius-control) bg-surface-sunken px-1 text-[0.75rem]">{node}</span>
              <span>{monitor}</span>
            </li>
          ))}
        </ul>
      )}
      {waiting && entry.steps.length === 0 && monitors.length === 0 && (
        <p className="pl-6 text-data text-ink-muted">{t("actionTray.noStep")}</p>
      )}
      {logs && entry.followedId !== undefined && (
        <DaemonIdLogs
          target={{ kind: entry.kind, id: entry.followedId, node: entry.node, subject: `${action} ${entry.subject}` }}
          onClose={() => {
            setLogs(false);
          }}
        />
      )}
    </li>
  );
}

export function ActionTray() {
  const { t } = useTranslation();
  const tracked = useActionTracker((s) => s.tracked);
  const clearEnded = useActionTracker((s) => s.clearEnded);
  // The dialog of the actions: opened from the bar, not on each action asked, which
  // a modal would put over what the user is doing; the bar says it goes.
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const running = tracked.filter((entry) => entry.state === "running").length;
  const ended = tracked.length - running;

  // The durations of what runs go on.
  useEffect(() => {
    if (running === 0) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 500);
    return () => {
      clearInterval(timer);
    };
  }, [running]);

  // None left, the dialog closes with the bar.
  useEffect(() => {
    if (tracked.length === 0) setOpen(false);
  }, [tracked.length]);

  if (tracked.length === 0) return null;
  const counts = [
    running > 0 ? t("actionTray.running", { count: running }) : null,
    ended > 0 ? t("actionTray.ended", { count: ended }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const failed = tracked.some((entry) => entry.state === "failed" || entry.state === "refused");
  const mark =
    running > 0 ? (
      <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-line border-t-accent" />
    ) : (
      <BoltIcon className={cn("h-3.5 w-3.5 shrink-0", failed ? "text-state-down" : "text-ink-muted")} />
    );

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${t("actionTray.title")}: ${counts}`}
        title={`${t("actionTray.title")}: ${counts}`}
        onClick={() => {
          setOpen(true);
        }}
        className="flex h-7 shrink-0 items-center gap-1 rounded-(--radius-control) border border-line px-1.5 text-ink-muted hover:bg-surface-sunken hover:text-ink"
      >
        {mark}
        <span aria-hidden="true" className="text-data tabular-nums">
          {tracked.length}
        </span>
      </button>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        title={
          <span className="flex min-w-0 items-center gap-2">
            {mark}
            <span>{t("actionTray.title")}</span>
            <span className="truncate text-data font-normal text-ink-muted">{counts}</span>
          </span>
        }
        footer={
          ended > 0 && (
            <Button onClick={clearEnded} icon={<TrashIcon className="h-3.5 w-3.5" />}>
              {t("actionTray.clear")}
            </Button>
          )
        }
      >
        <ol aria-label={t("actionTray.label")} className="-m-3 divide-y divide-line">
          {tracked.map((entry) => (
            <Entry
              key={entry.id}
              entry={entry}
              now={now}
              onLeave={() => {
                setOpen(false);
              }}
            />
          ))}
        </ol>
      </Dialog>
    </>
  );
}
