import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { actionLabel } from "../constants/actions";
import { cn } from "../ui/cn";
import { AlertTriangleIcon, BanIcon, BoltIcon, CheckIcon, ChevronDownIcon, CloseIcon, TrashIcon } from "../ui/icons";
import useEventStore from "../hooks/useEventStore.js";
import { type TrackState, type TrackStep, type Tracked, useActionTracker } from "./action-tracker";

/*
 * The actions asked, as they go: a tray in the corner of the window, whatever the
 * view, opened on each action asked. Each says where it stands, how long it took,
 * why it failed, and, for an orchestration, the run of each node it made. A
 * success leaves on its own after a while; a failure stays until dismissed.
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
    <span title={label} className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
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
        <span className="min-w-0 flex-1 truncate" title={step.title}>
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

function Entry({ entry, now }: { entry: Tracked; now: number }) {
  const { t } = useTranslation();
  const dismiss = useActionTracker((s) => s.dismiss);
  const action = entry.label ?? actionLabel(entry.action);
  const took = (entry.endedAt ?? now) - entry.startedAt;
  const state = t(`actionTray.states.${entry.state}`);
  const waiting = entry.state === "running" && entry.kind === "orchestration";
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
          <p className={cn("text-data", entry.state === "failed" || entry.state === "refused" ? "text-state-down" : "text-ink-muted")}>
            {state}
            {entry.state === "running" && entry.kind === "orchestration" && ` · ${t("actionTray.acceptedBy", { node: entry.node })}`}
            {entry.error && entry.error !== "gone" && ` · ${entry.error}`}
            {entry.error === "gone" && ` · ${t("actionTray.gone")}`}
          </p>
        </div>
        <span className="shrink-0 pt-0.5 text-data text-ink-muted tabular-nums">{formatDuration(took)}</span>
        <button
          type="button"
          title={t("actionTray.dismiss", { action, subject: entry.subject })}
          onClick={() => {
            dismiss(entry.id);
          }}
          className="shrink-0 rounded-full p-1 text-ink-muted hover:text-ink"
        >
          <CloseIcon className="h-3 w-3" />
          <span className="sr-only">{t("actionTray.dismiss", { action, subject: entry.subject })}</span>
        </button>
      </div>
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
    </li>
  );
}

export function ActionTray() {
  const { t } = useTranslation();
  const tracked = useActionTracker((s) => s.tracked);
  const revealed = useActionTracker((s) => s.revealed);
  const clearEnded = useActionTracker((s) => s.clearEnded);
  const [open, setOpen] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const running = tracked.filter((entry) => entry.state === "running").length;
  const ended = tracked.length - running;

  // A new action asked opens the tray.
  useEffect(() => {
    if (revealed > 0) setOpen(true);
  }, [revealed]);

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

  if (tracked.length === 0) return null;
  const counts = [
    running > 0 ? t("actionTray.running", { count: running }) : null,
    ended > 0 ? t("actionTray.ended", { count: ended }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const failed = tracked.some((entry) => entry.state === "failed" || entry.state === "refused");

  return (
    <section
      aria-label={t("actionTray.label")}
      className="fixed right-3 bottom-3 left-3 z-[1100] flex max-h-[60dvh] flex-col overflow-hidden rounded-(--radius-panel) border border-line bg-surface-raised text-ui shadow-lg sm:left-auto sm:w-[26rem]"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen((previous) => !previous);
          }}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {running > 0 ? (
            <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-line border-t-accent" />
          ) : (
            <BoltIcon className={cn("h-3.5 w-3.5 shrink-0", failed ? "text-state-down" : "text-ink-muted")} />
          )}
          <span className="font-semibold">{t("actionTray.title")}</span>
          <span className="truncate text-data text-ink-muted">{counts}</span>
          <ChevronDownIcon className={cn("ml-auto h-3.5 w-3.5 shrink-0 text-ink-muted transition-transform", open ? "" : "rotate-180")} />
        </button>
        {ended > 0 && (
          <button
            type="button"
            title={t("actionTray.clear")}
            onClick={clearEnded}
            className="shrink-0 rounded-(--radius-control) border border-line p-1 text-ink-muted hover:bg-surface-sunken hover:text-ink"
          >
            <TrashIcon className="h-3.5 w-3.5" />
            <span className="sr-only">{t("actionTray.clear")}</span>
          </button>
        )}
      </div>
      {open && (
        <ol className="min-h-0 divide-y divide-line overflow-y-auto">
          {tracked.map((entry) => (
            <Entry key={entry.id} entry={entry} now={now} />
          ))}
        </ol>
      )}
    </section>
  );
}
