import { create } from "zustand";
import { URL_NODE } from "../config/apiPath.js";
import { readClusterStatus } from "../hooks/clusterStatusOnce";
import useEventStore from "../hooks/useEventStore.js";

/*
 * The actions asked, followed to their end, as `om ... --wait` follows them: the
 * daemon accepts an action with the id of what it runs, then says how it goes.
 *
 * - An action of an object, of the cluster, or a drain is an orchestration: the
 *   node that accepted it answers for it (`daemon/orchestration/id/<id>`), and each
 *   node lists the runs it made of it (`daemon/exec?orchestration_id=<id>`).
 * - An action of an instance, of a resource or of a node is a run of one node
 *   (`daemon/exec/id/<id>`).
 *
 * Both are read with `wait`: the request is held until the end, no polling. The
 * runs of an orchestration, which no wait covers, are read again every few seconds
 * while it runs.
 */

export type TrackState = "running" | "succeeded" | "failed" | "aborted" | "refused" | "unknown";

/** A run of a node: one step of an orchestration, or the whole of an instance action. */
export interface TrackStep {
  execId: string;
  node: string;
  title: string;
  state: TrackState;
  error?: string;
  exitCode?: number;
  startedAt?: string;
  endedAt?: string;
}

export interface Tracked {
  id: string;
  action: string;
  /** What it is in words, for what is no daemon action (a configuration written); the action's label otherwise. */
  label?: string;
  subject: string;
  kind: "orchestration" | "exec";
  /** The node answering for it: the one that accepted the orchestration, or ran the exec. */
  node: string;
  /** The object it acts on, whose instance monitors say where an orchestration stands. */
  path?: string;
  state: TrackState;
  error?: string;
  startedAt: number;
  endedAt?: number;
  steps: TrackStep[];
}

/** What a POST of an action answered, as the daemon describes it. */
interface Accepted {
  orchestration_id?: string;
  exec_id?: string;
  node?: string;
}

interface ExecItem {
  exec_id: string;
  node: string;
  title?: string;
  command?: string;
  state: string;
  error?: string;
  exit_code?: number;
  started_at?: string;
  ended_at?: string;
}

interface OrchestrationItem {
  state: string;
  error?: string;
}

/** How long a request is held by the daemon until what it follows ends. */
const WAIT = "30s";
/** How often the runs of an orchestration are read while it runs. */
const STEPS_EVERY_MS = 2000;
/** Read errors in a row before the outcome is given up as unknown. */
const MAX_ERRORS = 5;
/** The actions kept, the oldest ended ones dropped first. */
const MAX_TRACKED = 30;
/** A success leaves on its own after a while; a failure stays until dismissed. */
export const SUCCESS_LINGER_MS = 120_000;

interface TrackerState {
  tracked: Tracked[];
  /** The tray asked open: a new action was asked. */
  revealed: number;
  dismiss: (id: string) => void;
  clearEnded: () => void;
}

export const useActionTracker = create<TrackerState>((set) => ({
  tracked: [],
  revealed: 0,
  dismiss: (id) => {
    set((s) => ({ tracked: s.tracked.filter((t) => t.id !== id) }));
  },
  clearEnded: () => {
    set((s) => ({ tracked: s.tracked.filter((t) => t.state === "running") }));
  },
}));

const update = (id: string, change: Partial<Tracked>) => {
  useActionTracker.setState((s) => ({
    tracked: s.tracked.map((t) => (t.id === id ? { ...t, ...change } : t)),
  }));
};

const isLive = (id: string) => useActionTracker.getState().tracked.some((t) => t.id === id);

const toState = (state: string | undefined): TrackState =>
  state === "running" || state === "succeeded" || state === "failed" || state === "aborted" || state === "refused"
    ? state
    : "unknown";

const toStep = (exec: ExecItem): TrackStep => ({
  execId: exec.exec_id,
  node: exec.node,
  title: exec.title || exec.command || "",
  state: toState(exec.state),
  error: exec.error || undefined,
  exitCode: exec.exit_code,
  startedAt: exec.started_at,
  endedAt: exec.ended_at,
});

const headers = () => ({ Authorization: `Bearer ${localStorage.getItem("authToken") ?? ""}` });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const daemonUrl = (node: string, rest: string) => `${URL_NODE}/${encodeURIComponent(node)}/daemon/${rest}`;

/**
 * Reads what `url` says until it ends: held by the daemon (`wait`), read again on
 * a 408 (the wait ran out first). Resolves to the item ended, or to the reason it
 * could not be known.
 */
async function waitEnd<T extends { state: string }>(url: string, id: string): Promise<T | { lost: string }> {
  let errors = 0;
  for (;;) {
    if (!isLive(id)) return { lost: "" };
    try {
      const response = await fetch(`${url}?wait=${WAIT}`, { headers: headers() });
      if (response.status === 408) continue;
      // Ended long ago and dropped: how it went is no longer known.
      if (response.status === 410) return { lost: "gone" };
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      const item = (await response.json()) as T;
      if (item.state !== "running") return item;
      errors = 0;
    } catch (err) {
      errors += 1;
      if (errors >= MAX_ERRORS) return { lost: err instanceof Error ? err.message : String(err) };
      await sleep(1000 * errors);
    }
  }
}

/** The runs of an orchestration on every node of the cluster, in the order they started. */
async function readSteps(orchestrationId: string, nodes: string[]): Promise<TrackStep[] | null> {
  const lists = await Promise.all(
    nodes.map(async (node) => {
      try {
        const response = await fetch(
          daemonUrl(node, `exec?orchestration_id=${encodeURIComponent(orchestrationId)}`),
          { headers: headers() },
        );
        if (!response.ok) return [];
        const body = (await response.json()) as { items?: ExecItem[] };
        return body.items ?? [];
      } catch {
        return [];
      }
    }),
  );
  const steps = lists.flat().map(toStep);
  if (steps.length === 0) return null;
  return steps.sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
}

async function followOrchestration(id: string, orchestrationId: string, node: string) {
  const status = await readClusterStatus().catch(() => null);
  const configured = (status as { cluster?: { config?: { nodes?: string[] } } } | null)?.cluster?.config?.nodes;
  const nodes = Array.isArray(configured) && configured.length > 0 ? configured : [node];
  let running = true;
  // Ended, the runs are read at once, not a pause later.
  let stop: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    stop = resolve;
  });
  const refreshSteps = async () => {
    const steps = await readSteps(orchestrationId, nodes);
    if (steps !== null && isLive(id)) update(id, { steps });
  };
  const stepsLoop = (async () => {
    while (running && isLive(id)) {
      await refreshSteps();
      await Promise.race([sleep(STEPS_EVERY_MS), stopped]);
    }
  })();
  const end = await waitEnd<OrchestrationItem>(daemonUrl(node, `orchestration/id/${encodeURIComponent(orchestrationId)}`), id);
  running = false;
  stop();
  await stepsLoop;
  if (!isLive(id)) return;
  await refreshSteps();
  if ("lost" in end) {
    update(id, { state: "unknown", error: end.lost || undefined, endedAt: Date.now() });
    return;
  }
  update(id, { state: toState(end.state), error: end.error || undefined, endedAt: Date.now() });
  lingerIfSucceeded(id);
}

async function followExec(id: string, execId: string, node: string) {
  const end = await waitEnd<ExecItem>(daemonUrl(node, `exec/id/${encodeURIComponent(execId)}`), id);
  if (!isLive(id)) return;
  if ("lost" in end) {
    update(id, { state: "unknown", error: end.lost || undefined, endedAt: Date.now() });
    return;
  }
  const step = toStep(end);
  update(id, { state: step.state, error: step.error, steps: [step], endedAt: Date.now() });
  lingerIfSucceeded(id);
}

function lingerIfSucceeded(id: string) {
  const ended = useActionTracker.getState().tracked.find((t) => t.id === id);
  if (ended?.state !== "succeeded") return;
  setTimeout(() => {
    useActionTracker.getState().dismiss(id);
  }, SUCCESS_LINGER_MS);
}

let sequence = 0;

/**
 * Follows the action the daemon accepted with `accepted`, the body of its answer:
 * `action` and `subject` say it in words, `node` is the node the request went to,
 * for an exec that names no node of its own. An answer naming nothing to follow
 * (a refresh, a clear) is not followed.
 */
export function trackAccepted(
  accepted: unknown,
  { action, subject, node, path }: { action: string; subject: string; node?: string; path?: string },
) {
  const body = (accepted ?? {}) as Accepted;
  const orchestrationId = body.orchestration_id;
  const execId = body.exec_id;
  if (!orchestrationId && !execId) return;
  sequence += 1;
  const id = `${String(Date.now())}-${String(sequence)}`;
  const answering = body.node || node || "localhost";
  const tracked: Tracked = {
    id,
    action,
    subject,
    kind: orchestrationId ? "orchestration" : "exec",
    node: answering,
    ...(path === undefined ? {} : { path }),
    state: "running",
    startedAt: Date.now(),
    steps: [],
  };
  useActionTracker.setState((s) => {
    const all = [tracked, ...s.tracked];
    // Over the limit, the oldest ended ones go; the running ones stay.
    while (all.length > MAX_TRACKED) {
      const index = all.map((t) => t.state !== "running").lastIndexOf(true);
      if (index < 0) break;
      all.splice(index, 1);
    }
    return { tracked: all, revealed: s.revealed + 1 };
  });
  if (orchestrationId) void followOrchestration(id, orchestrationId, answering);
  else if (execId) void followExec(id, execId, answering);
}

/**
 * An action the daemon refused, or that could not be asked: in the tray as the
 * others, ended, with the reason. `action` and `subject` say it in words.
 */
export function trackRefused({
  action,
  subject,
  reason,
  label,
}: {
  action: string;
  subject: string;
  reason: string;
  label?: string;
}) {
  sequence += 1;
  const now = Date.now();
  const refused: Tracked = {
    id: `${String(now)}-${String(sequence)}`,
    action,
    ...(label === undefined ? {} : { label }),
    subject,
    kind: "exec",
    node: "",
    state: "refused",
    error: reason || undefined,
    startedAt: now,
    endedAt: now,
    steps: [],
  };
  useActionTracker.setState((s) => ({ tracked: [refused, ...s.tracked].slice(0, MAX_TRACKED), revealed: s.revealed + 1 }));
}

/**
 * An action done by the time the daemon answered, with nothing to follow (enable,
 * disable: 204 No Content): in the tray as the others, ended, succeeded.
 */
export function trackDone({ action, subject, path, label }: { action: string; subject: string; path?: string; label?: string }) {
  sequence += 1;
  const now = Date.now();
  const id = `${String(now)}-${String(sequence)}`;
  const done: Tracked = {
    id,
    action,
    ...(label === undefined ? {} : { label }),
    subject,
    kind: "exec",
    node: "",
    ...(path === undefined ? {} : { path }),
    state: "succeeded",
    startedAt: now,
    endedAt: now,
    steps: [],
  };
  useActionTracker.setState((s) => ({ tracked: [done, ...s.tracked].slice(0, MAX_TRACKED), revealed: s.revealed + 1 }));
  lingerIfSucceeded(id);
}

/**
 * Says the answer of an action the daemon accepted: followed when it names what
 * runs it (an orchestration, an exec), done when it names nothing, the daemon
 * having acted before it answered.
 */
export async function trackResponse(
  response: Response,
  info: { action: string; subject: string; node?: string; path?: string; label?: string },
) {
  const body = (await acceptedBody(response)) as Accepted | null;
  if (body?.orchestration_id || body?.exec_id) trackAccepted(body, info);
  else trackDone(info);
}

/**
 * Says what came of a write the daemon does before it answers (a configuration, a
 * key): done when accepted, refused with the reason otherwise. `reason` reads the
 * reason of a refusal from the response. Resolves to whether it was accepted.
 */
export async function trackWrite(
  response: Response,
  info: { action: string; subject: string; label: string; path?: string },
  reason: (response: Response) => Promise<string>,
): Promise<boolean> {
  if (response.ok) {
    trackDone(info);
    return true;
  }
  trackRefused({ ...info, reason: await reason(response) });
  return false;
}

/** How long an action queued is waited for, before its outcome is said unknown. */
export const UNTIL_TIMEOUT_MS = 60_000;

/**
 * Follows an action the daemon queued with nothing to follow (a heartbeat started,
 * stopped, restarted): running until `reached`, read from the events the store
 * holds, says it is done; unknown with `lost` past `timeoutMs`.
 */
export function trackUntil(
  info: { action: string; subject: string; label?: string },
  reached: (store: unknown) => boolean,
  { lost, timeoutMs = UNTIL_TIMEOUT_MS }: { lost: string; timeoutMs?: number },
) {
  sequence += 1;
  const id = `${String(Date.now())}-${String(sequence)}`;
  const entry: Tracked = {
    id,
    action: info.action,
    ...(info.label === undefined ? {} : { label: info.label }),
    subject: info.subject,
    kind: "exec",
    node: "",
    state: "running",
    startedAt: Date.now(),
    steps: [],
  };
  useActionTracker.setState((s) => ({ tracked: [entry, ...s.tracked].slice(0, MAX_TRACKED), revealed: s.revealed + 1 }));
  let unsubscribe: () => void = () => undefined;
  const end = (change: Partial<Tracked>) => {
    unsubscribe();
    clearTimeout(timer);
    if (!isLive(id)) return;
    update(id, { ...change, endedAt: Date.now() });
    lingerIfSucceeded(id);
  };
  const timer = setTimeout(() => {
    end({ state: "unknown", error: lost });
  }, timeoutMs);
  const check = (store: unknown) => {
    if (reached(store)) end({ state: "succeeded" });
  };
  unsubscribe = (useEventStore as unknown as { subscribe: (fn: (s: unknown) => void) => () => void }).subscribe(check);
  check((useEventStore as unknown as { getState: () => unknown }).getState());
}

/** How often what no event tells is read again, while an action queued is followed. */
const POLL_EVERY_MS = 2000;

/**
 * Follows an action the daemon queued, whose effect no event the webapp hears tells
 * (the listener restarted, an exec signaled): `probe` reads it again every few
 * seconds, done when it resolves true; a read failing is tried again (the listener
 * restarting does not answer for a while); unknown with `lost` past `timeoutMs`.
 */
export function trackPoll(
  info: { action: string; subject: string; label?: string },
  probe: () => Promise<boolean>,
  { lost, timeoutMs = UNTIL_TIMEOUT_MS, everyMs = POLL_EVERY_MS }: { lost: string; timeoutMs?: number; everyMs?: number },
) {
  sequence += 1;
  const id = `${String(Date.now())}-${String(sequence)}`;
  const startedAt = Date.now();
  useActionTracker.setState((s) => ({
    tracked: [
      {
        id,
        action: info.action,
        ...(info.label === undefined ? {} : { label: info.label }),
        subject: info.subject,
        kind: "exec" as const,
        node: "",
        state: "running" as const,
        startedAt,
        steps: [],
      },
      ...s.tracked,
    ].slice(0, MAX_TRACKED),
    revealed: s.revealed + 1,
  }));
  void (async () => {
    while (isLive(id)) {
      if (Date.now() - startedAt > timeoutMs) {
        update(id, { state: "unknown", error: lost, endedAt: Date.now() });
        return;
      }
      let reached = false;
      try {
        reached = await probe();
      } catch {
        // Not answering for now: read again.
      }
      if (reached) {
        if (!isLive(id)) return;
        update(id, { state: "succeeded", endedAt: Date.now() });
        lingerIfSucceeded(id);
        return;
      }
      await sleep(everyMs);
    }
  })();
}

/** The body of an accepted answer, null when it holds no JSON. */
export async function acceptedBody(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}
