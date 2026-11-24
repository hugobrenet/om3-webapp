import { create } from "zustand";
import { URL_NODE } from "../config/apiPath.js";
import { readClusterStatus } from "../hooks/clusterStatusOnce";
import useEventStore from "../hooks/useEventStore.js";
import { recordConfigWrite } from "./config-stamps";
import { pacedFetch } from "../services/paced-fetch.js";

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
 * Both are read again until they end (END_EVERY_MS says why not held), the runs of
 * an orchestration every few seconds while it runs. The orchestrations followed at
 * once, an action on a selection, are read together (`gathered`): a list of a node
 * for all, by their objects, not a read each.
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
  /** The id the daemon runs it under, the orchestration or the exec: what its logs are filtered by. */
  followedId?: string;
  /** The node answering for it: the one that accepted the orchestration, or ran the exec. */
  node: string;
  /** The object it acts on, whose instance monitors say where an orchestration stands. */
  path?: string;
  /** An orchestration the node answered for before its monitor read it: taken on, or refused, later. */
  queued?: boolean;
  /** What went wrong beside a write done: a service installing a key written that failed to refresh, one a line. */
  warnings?: string[];
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
  queued?: boolean;
}

interface ExecItem {
  exec_id: string;
  orchestration_id?: string;
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
  orchestration_id?: string;
  state: string;
  error?: string;
}

/**
 * How often an action is read again until it ends. A read the daemon held until the
 * end (`wait`) would keep a connection of the browser per action: over HTTP/1.1,
 * six a host, the event streams holding two, a batch of actions queues behind its
 * own waits, and an action ended long ago stays running in the tray. Read without
 * holding, a read queued is late by a moment, not by the wait.
 */
export const END_EVERY_MS = 1000;
/** How often the runs of an orchestration are read while it runs. */
const STEPS_EVERY_MS = 2000;
/** Read errors in a row before the outcome is given up as unknown. */
const MAX_ERRORS = 5;
/** How long an orchestration queued may stay unknown by its id, its monitor yet to read it. */
export const QUEUED_TIMEOUT_MS = 120_000;
/** The actions kept, the oldest ended ones dropped first. */
const MAX_TRACKED = 30;
/** A success leaves on its own after a while; a failure stays until dismissed. */
export const SUCCESS_LINGER_MS = 120_000;

interface TrackerState {
  tracked: Tracked[];
  dismiss: (id: string) => void;
  clearEnded: () => void;
}

export const useActionTracker = create<TrackerState>((set) => ({
  tracked: [],
  dismiss: (id) => {
    set((s) => ({ tracked: s.tracked.filter((t) => t.id !== id) }));
  },
  clearEnded: () => {
    set((s) => ({ tracked: s.tracked.filter((t) => t.state === "running") }));
  },
}));

/**
 * The orchestrations seen ended, by their id: a monitor still saying one a moment
 * after its end, or after it was dismissed, follows it no more (observeMonitors).
 */
const endedIds = new Set<string>();
const MAX_ENDED_IDS = 1000;

const update = (id: string, change: Partial<Tracked>) => {
  useActionTracker.setState((s) => ({
    tracked: s.tracked.map((t) => (t.id === id ? { ...t, ...change } : t)),
  }));
  if (change.state !== undefined && change.state !== "running") {
    const ended = useActionTracker.getState().tracked.find((t) => t.id === id);
    if (ended?.followedId !== undefined) endedIds.add(ended.followedId);
    // The oldest forgotten: their monitors long done with them.
    if (endedIds.size > MAX_ENDED_IDS) endedIds.delete(endedIds.values().next().value as string);
  }
};

const isLive = (id: string) => useActionTracker.getState().tracked.some((t) => t.id === id);

/** Kept and not ended yet: an orchestration its end event ended is read no more. */
const isRunning = (id: string) => useActionTracker.getState().tracked.some((t) => t.id === id && t.state === "running");

/** The orchestration of id `orchestrationId` tracked, if it is. */
const followed = (orchestrationId: string) =>
  useActionTracker.getState().tracked.find((t) => t.kind === "orchestration" && t.followedId === orchestrationId);

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

/** What a read answers: a response of the daemon, or an item of a list read, said as one. */
interface Answer {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
}

const answer = (status: number, item?: unknown): Answer => ({
  status,
  ok: status >= 200 && status < 300,
  json: () => Promise.resolve(item),
});

/** The longest selector of a list read, its paths joined: more, read in parts. */
const MAX_SELECTOR = 2000;

/**
 * The items `node` lists of `what` (orchestration, exec) for the objects of `paths`,
 * their selector: in parts of MAX_SELECTOR. The status of the first part refused, the
 * items then said nothing of.
 */
async function readListed<T>(node: string, what: string, paths: Iterable<string>): Promise<{ status: number; items: T[] }> {
  const parts: string[][] = [[]];
  let length = 0;
  for (const path of new Set(paths)) {
    if (length + path.length > MAX_SELECTOR && parts[parts.length - 1].length > 0) {
      parts.push([]);
      length = 0;
    }
    parts[parts.length - 1].push(path);
    length += path.length + 1;
  }
  const lists = await Promise.all(
    parts.map(async (part) => {
      const response = await pacedFetch(daemonUrl(node, `${what}?selector=${encodeURIComponent(part.join(","))}`), {
        headers: headers(),
      });
      if (!response.ok) return { status: response.status, items: [] as T[] };
      const body = (await response.json()) as { items?: T[] };
      return { status: response.status, items: body.items ?? [] };
    }),
  );
  const refused = lists.find((list) => list.status < 200 || list.status >= 300);
  return refused ?? { status: 200, items: lists.flatMap((list) => list.items) };
}

/**
 * The reads of what is followed at once, gathered: an action on hundreds of objects
 * followed by a read of a node a second, not hundreds of reads, which their pace
 * (paced-fetch) took minutes to send, the tray saying running long after the
 * objects were done. A read asked joins the next one due, sent once the one before
 * has answered (none queued behind it, the writes going first) and END_EVERY_MS
 * after it was sent, at once when none was. One alone is read on its own
 * (`one`), as it always was; more, `many` reads the list of them, by key, their
 * paths given: a key it says nothing of, read on its own.
 */
function gathered<R>(
  one: (key: string) => Promise<R>,
  many: (paths: Map<string, string>) => Promise<Map<string, R>>,
): (key: string, path: string) => Promise<R> {
  let paths = new Map<string, string>();
  let waiting = new Map<string, { resolve: (r: R) => void; reject: (e: unknown) => void }[]>();
  let due = false;
  let busy = false;
  let sentAt = 0;
  const schedule = () => {
    if (due || busy || paths.size === 0) return;
    due = true;
    const wait = sentAt + END_EVERY_MS - Date.now();
    if (wait > 0) setTimeout(send, wait);
    else queueMicrotask(send);
  };
  const sent = (read: Promise<unknown>) => {
    busy = true;
    void read.catch(() => undefined).then(() => {
      busy = false;
      schedule();
    });
  };
  const send = () => {
    due = false;
    sentAt = Date.now();
    const asked = paths;
    const waiters = waiting;
    paths = new Map();
    waiting = new Map();
    const settle = (key: string, read: Promise<R>) => {
      read.then(
        (r) => waiters.get(key)?.forEach((w) => w.resolve(r)),
        (e: unknown) => waiters.get(key)?.forEach((w) => w.reject(e)),
      );
    };
    if (asked.size === 1) {
      const [key] = asked.keys();
      const read = one(key);
      sent(read);
      settle(key, read);
      return;
    }
    const listed = many(asked);
    sent(listed);
    for (const key of asked.keys()) settle(key, listed.then((items) => items.get(key) ?? one(key)));
  };
  return (key, path) =>
    new Promise<R>((resolve, reject) => {
      paths.set(key, path);
      waiting.set(key, [...(waiting.get(key) ?? []), { resolve, reject }]);
      schedule();
    });
}

/** The reads of the orchestrations a node answers for, gathered, by node. */
const orchestrationReads = new Map<string, (orchestrationId: string, path: string) => Promise<Answer>>();

function readOrchestration(node: string, orchestrationId: string, path?: string): Promise<Answer> {
  const one = (key: string) =>
    pacedFetch(daemonUrl(node, `orchestration/id/${encodeURIComponent(key)}`), { headers: headers() });
  if (!path) return one(orchestrationId);
  let read = orchestrationReads.get(node);
  if (!read) {
    read = gathered<Answer>(one, async (paths) => {
      const listed = await readListed<OrchestrationItem>(node, "orchestration", paths.values());
      const answers = new Map<string, Answer>();
      if (listed.status !== 200) {
        for (const key of paths.keys()) answers.set(key, answer(listed.status));
        return answers;
      }
      for (const item of listed.items) {
        if (item.orchestration_id && paths.has(item.orchestration_id)) answers.set(item.orchestration_id, answer(200, item));
      }
      return answers;
    });
    orchestrationReads.set(node, read);
  }
  return read(orchestrationId, path);
}

/** The reads of the runs of orchestrations on a node, gathered, by node. */
const execReads = new Map<string, (orchestrationId: string, path: string) => Promise<ExecItem[]>>();

async function readExecs(node: string, orchestrationId: string): Promise<ExecItem[]> {
  try {
    const response = await pacedFetch(daemonUrl(node, `exec?orchestration_id=${encodeURIComponent(orchestrationId)}`), {
      headers: headers(),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { items?: ExecItem[] };
    return body.items ?? [];
  } catch {
    return [];
  }
}

function readRuns(node: string, orchestrationId: string, path?: string): Promise<ExecItem[]> {
  if (!path) return readExecs(node, orchestrationId);
  let read = execReads.get(node);
  if (!read) {
    read = gathered<ExecItem[]>(
      (key) => readExecs(node, key),
      async (paths) => {
        // The runs of their objects, of any orchestration or none: those of each kept.
        const listed = await readListed<ExecItem>(node, "exec", paths.values()).catch(() => ({ status: 0, items: [] }));
        const runs = new Map<string, ExecItem[]>([...paths.keys()].map((key) => [key, []]));
        for (const item of listed.items) {
          if (item.orchestration_id) runs.get(item.orchestration_id)?.push(item);
        }
        return runs;
      },
    );
    execReads.set(node, read);
  }
  return read(orchestrationId, path);
}

/**
 * Reads what `url` says until it ends, every `END_EVERY_MS`, no read held by the
 * daemon (END_EVERY_MS says why). Resolves to the item ended, or to the reason it
 * could not be known.
 */
async function waitEnd<T extends { state: string }>(
  read: () => Promise<Answer>,
  id: string,
  { queued = false, seen }: { queued?: boolean; seen?: () => void } = {},
): Promise<T | { lost: string } | { forbidden: true }> {
  let errors = 0;
  // Queued, its monitor has yet to read it: unknown by its id until then.
  let unseenSince = queued ? Date.now() : null;
  for (;;) {
    if (!isRunning(id)) return { lost: "" };
    try {
      // Paced: hundreds of actions followed at once stay within what the daemon takes.
      const response = await read();
      // A daemon holding it all the same (a wait run out): read again.
      if (response.status === 408) continue;
      // A user the daemon lets read none (root only): read again, refused again.
      if (response.status === 401 || response.status === 403) return { forbidden: true };
      if (response.status === 410) {
        // Ended long ago and dropped: how it went is no longer known.
        if (unseenSince === null) return { lost: "gone" };
        if (Date.now() - unseenSince > QUEUED_TIMEOUT_MS) return { lost: "queued" };
        await sleep(END_EVERY_MS);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      if (unseenSince !== null) {
        unseenSince = null;
        seen?.();
      }
      const item = (await response.json()) as T;
      if (item.state !== "running") return item;
      errors = 0;
      await sleep(END_EVERY_MS);
    } catch (err) {
      errors += 1;
      if (errors >= MAX_ERRORS) return { lost: err instanceof Error ? err.message : String(err) };
      await sleep(1000 * errors);
    }
  }
}

/** The runs of an orchestration on every node of the cluster, in the order they started. */
async function readSteps(orchestrationId: string, nodes: string[], path?: string): Promise<TrackStep[] | null> {
  const lists = await Promise.all(nodes.map((node) => readRuns(node, orchestrationId, path)));
  const steps = lists.flat().map(toStep);
  if (steps.length === 0) return null;
  return steps.sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
}

async function followOrchestration(id: string, orchestrationId: string, node: string, queued = false, path?: string) {
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
    const steps = await readSteps(orchestrationId, nodes, path);
    if (steps !== null && isLive(id)) update(id, { steps });
  };
  const stepsLoop = (async () => {
    while (running && isLive(id)) {
      await refreshSteps();
      await Promise.race([sleep(STEPS_EVERY_MS), stopped]);
    }
  })();
  const end = await waitEnd<OrchestrationItem>(() => readOrchestration(node, orchestrationId, path), id, {
    queued,
    seen: () => {
      update(id, { queued: false });
    },
  });
  if ("forbidden" in end) {
    // Its end said by its event alone, or, missed, by its monitors (observeMonitors).
    unread.add(id);
    checkUnread();
  }
  running = false;
  stop();
  await stepsLoop;
  // Its runs refused as it was: read no more.
  if (!isLive(id) || "forbidden" in end) return;
  await refreshSteps();
  // Ended meanwhile by the event saying so (observeOrchestration).
  if (!isRunning(id)) return;
  if ("lost" in end) {
    update(id, { state: "unknown", error: end.lost || undefined, endedAt: Date.now() });
    return;
  }
  update(id, { state: toState(end.state), error: end.error || undefined, endedAt: Date.now() });
  lingerIfSucceeded(id);
}

async function followExec(id: string, execId: string, node: string) {
  const url = daemonUrl(node, `exec/id/${encodeURIComponent(execId)}`);
  const end = await waitEnd<ExecItem>(() => pacedFetch(url, { headers: headers() }), id);
  if (!isLive(id)) return;
  if ("forbidden" in end) {
    update(id, { state: "unknown", error: "HTTP 403", endedAt: Date.now() });
    return;
  }
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
 * The actions tracked, a new one first. Over the limit, the oldest ended ones go;
 * the running ones stay, followed to their end.
 */
function withNew(entry: Tracked, tracked: Tracked[]): Tracked[] {
  const all = [entry, ...tracked];
  while (all.length > MAX_TRACKED) {
    const index = all.map((t) => t.state !== "running").lastIndexOf(true);
    if (index < 0) break;
    all.splice(index, 1);
  }
  return all;
}

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
  // Seen first in the events, as every orchestration of the cluster is: said in the
  // words of the action asked, followed already.
  const seen = orchestrationId ? followed(orchestrationId) : undefined;
  if (seen) {
    update(seen.id, { action, subject, ...(path === undefined ? {} : { path }) });
    return;
  }
  sequence += 1;
  const id = `${String(Date.now())}-${String(sequence)}`;
  const answering = body.node || node || "localhost";
  const tracked: Tracked = {
    id,
    action,
    subject,
    kind: orchestrationId ? "orchestration" : "exec",
    followedId: orchestrationId || execId,
    node: answering,
    ...(path === undefined ? {} : { path }),
    ...(orchestrationId && body.queued === true ? { queued: true } : {}),
    state: "running",
    startedAt: Date.now(),
    steps: [],
  };
  useActionTracker.setState((s) => ({ tracked: withNew(tracked, s.tracked) }));
  if (orchestrationId) void followOrchestration(id, orchestrationId, answering, body.queued === true, path);
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
  orchestrationId,
  node,
}: {
  action: string;
  subject: string;
  reason: string;
  label?: string;
  /**
   * The orchestration the daemon recorded the refusal under (an object action its
   * instance monitor refused), and the node answering for it: its logs a click away,
   * as an orchestration accepted. The nil id names none.
   */
  orchestrationId?: string;
  node?: string;
}) {
  const recorded = orchestrationId !== undefined && orchestrationId !== "" && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(orchestrationId);
  // Seen first in the events: said in the words of the action asked.
  const seen = recorded ? followed(orchestrationId) : undefined;
  if (seen) {
    update(seen.id, {
      action,
      ...(label === undefined ? {} : { label }),
      subject,
      ...(seen.state === "running" ? { state: "refused" as const, error: reason || undefined, endedAt: Date.now() } : {}),
    });
    return;
  }
  sequence += 1;
  const now = Date.now();
  const refused: Tracked = {
    id: `${String(now)}-${String(sequence)}`,
    action,
    ...(label === undefined ? {} : { label }),
    subject,
    ...(recorded ? { kind: "orchestration" as const, followedId: orchestrationId, node: node ?? "" } : { kind: "exec" as const, node: "" }),
    state: "refused",
    error: reason || undefined,
    startedAt: now,
    endedAt: now,
    steps: [],
  };
  useActionTracker.setState((s) => ({ tracked: withNew(refused, s.tracked) }));
}

/**
 * An action done by the time the daemon answered, with nothing to follow (enable,
 * disable: 204 No Content): in the tray as the others, ended, succeeded.
 */
export function trackDone({
  action,
  subject,
  path,
  label,
  note,
  warnings,
}: {
  action: string;
  subject: string;
  path?: string;
  label?: string;
  /** What is still to come of it, said beside it: a configuration still propagating. */
  note?: string;
  /** What went wrong beside it, one a line: kept in the tray until dismissed. */
  warnings?: string[];
}) {
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
    ...(note === undefined ? {} : { error: note }),
    ...(warnings?.length ? { warnings } : {}),
    state: "succeeded",
    startedAt: now,
    endedAt: now,
    steps: [],
  };
  useActionTracker.setState((s) => ({ tracked: withNew(done, s.tracked) }));
  // Its warnings stay until read.
  if (!warnings?.length) lingerIfSucceeded(id);
}

/**
 * An action the node answers only once done (a network setup, two minutes at most):
 * running in the tray from its request on, ended by its answer. `ended` says it
 * done; `refused` says why it was not, the state of an answer after it ran told by
 * its status: a server error failed, a wait run out unknown, the others refused.
 */
export function trackPending(info: { action: string; subject: string; node?: string; label?: string }) {
  sequence += 1;
  const id = `${String(Date.now())}-${String(sequence)}`;
  const entry: Tracked = {
    id,
    action: info.action,
    ...(info.label === undefined ? {} : { label: info.label }),
    subject: info.subject,
    kind: "exec",
    node: info.node ?? "",
    state: "running",
    startedAt: Date.now(),
    steps: [],
  };
  useActionTracker.setState((s) => ({ tracked: withNew(entry, s.tracked) }));
  return {
    ended: () => {
      if (!isLive(id)) return;
      update(id, { state: "succeeded", endedAt: Date.now() });
      lingerIfSucceeded(id);
    },
    refused: (reason: string, status?: number) => {
      if (!isLive(id)) return;
      const state: TrackState =
        status === undefined || status >= 500 ? "failed" : status === 408 ? "unknown" : "refused";
      update(id, { state, error: reason, endedAt: Date.now() });
    },
  };
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
 * reason of a refusal from the response. Resolves to whether it was accepted:
 * a wait for the configuration to reach the nodes that expired (408) is a write
 * done, the nodes it has not reached said beside it.
 */
export async function trackWrite(
  response: Response,
  info: { action: string; subject: string; label: string; path?: string },
  reason: (response: Response) => Promise<string>,
): Promise<boolean> {
  if (response.ok || response.status === 408) {
    // The configuration written, for the instance actions that follow to ask for it.
    recordConfigWrite(info.path, response);
    if (!response.ok) {
      trackDone({ ...info, note: await problemDetail(response) });
      return true;
    }
    // A key written answers what failed beside it: a service installing it that
    // could not refresh. Older nodes answer 204, no body.
    const committed = response.status === 200 ? ((await acceptedBody(response)) as { warnings?: unknown } | null) : null;
    const warnings = Array.isArray(committed?.warnings)
      ? committed.warnings.filter((w): w is string => typeof w === "string" && w !== "")
      : [];
    trackDone({ ...info, warnings });
    return true;
  }
  trackRefused({ ...info, reason: await reason(response) });
  return false;
}

/** The detail of the problem an answer holds, its status when it holds none. */
async function problemDetail(response: Response): Promise<string> {
  try {
    const problem = (await response.json()) as { detail?: string } | null;
    if (problem?.detail) return problem.detail;
  } catch {
    // Not a problem document.
  }
  return `HTTP ${String(response.status)}`;
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
  useActionTracker.setState((s) => ({ tracked: withNew(entry, s.tracked) }));
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
    tracked: withNew(
      {
        id,
        action: info.action,
        ...(info.label === undefined ? {} : { label: info.label }),
        subject: info.subject,
        kind: "exec",
        node: "",
        state: "running",
        startedAt,
        steps: [],
      },
      s.tracked,
    ),
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

/** The action an orchestration is for, by the state it expects (global_expect, expect). */
export function expectAction(expect: string | undefined | null): string {
  if (!expect) return "";
  if (expect.startsWith("placed@")) return "switch";
  const actions: Record<string, string> = {
    aborted: "abort",
    deleted: "delete",
    drained: "drain",
    frozen: "freeze",
    placed: "giveback",
    provisioned: "provision",
    purged: "purge",
    resized: "scale",
    restarted: "restart",
    started: "start",
    stopped: "stop",
    thawed: "unfreeze",
    unfrozen: "unfreeze",
    unprovisioned: "unprovision",
    upgraded: "upgrade",
  };
  return actions[expect] ?? expect;
}

/** An orchestration event of the daemon, of an object (path) or a node. */
export interface OrchestrationEvent {
  id?: string;
  node?: string;
  path?: string;
  expect?: string;
  global_expect?: string | null;
  aborted?: boolean;
  failed?: boolean;
  error?: string;
  reason?: string;
}

/**
 * Every orchestration of the cluster in the tray, not only those asked from this
 * page: one accepted, asked from another page, by om, by another user, followed as
 * the others (`Object|NodeOrchestrationAccepted`); its end said as soon as the event
 * says it (`…End`, `…Refused`), the reads of it, a user the daemon lets read none,
 * not waited for. Once each, whichever of the event and the answer of this page's
 * action comes first.
 */
export function observeOrchestration(kind: string, event: OrchestrationEvent) {
  const orchestrationId = event.id;
  if (!orchestrationId) return;
  const seen = followed(orchestrationId);
  const action = expectAction(event.expect ?? event.global_expect);
  const subject = event.path || event.node || "";
  if (kind.endsWith("OrchestrationAccepted")) {
    if (!seen) follow({ orchestrationId, action, subject, node: event.node, path: event.path });
    return;
  }
  if (kind.endsWith("OrchestrationRefused")) {
    if (!seen) trackRefused({ action, subject, reason: event.reason ?? "", orchestrationId, node: event.node });
    else if (seen.state === "running") update(seen.id, { state: "refused", error: event.reason || undefined, endedAt: Date.now() });
    return;
  }
  if (kind.endsWith("OrchestrationEnd") && seen?.state === "running") {
    const state: TrackState = event.aborted ? "aborted" : event.failed ? "failed" : "succeeded";
    update(seen.id, { state, error: event.error || undefined, queued: false, endedAt: Date.now() });
    lingerIfSucceeded(seen.id);
  }
}

/** An orchestration not asked from this page, followed from now on. */
function follow({
  orchestrationId,
  action,
  subject,
  node,
  path,
  startedAt = Date.now(),
}: {
  orchestrationId: string;
  action: string;
  subject: string;
  node?: string;
  path?: string;
  startedAt?: number;
}) {
  sequence += 1;
  const id = `${String(Date.now())}-${String(sequence)}`;
  // Any node answers for an object's: the one accepting it, else this one.
  const answering = node || "localhost";
  const entry: Tracked = {
    id,
    action,
    subject,
    kind: "orchestration",
    followedId: orchestrationId,
    node: answering,
    ...(path ? { path } : {}),
    state: "running",
    startedAt,
    steps: [],
  };
  useActionTracker.setState((s) => ({ tracked: withNew(entry, s.tracked) }));
  void followOrchestration(id, orchestrationId, answering, false, path || undefined);
}

/**
 * The orchestrations running when the events start, which they will not say were
 * accepted: read from the daemon (root only; refused, the events alone).
 */
export async function followRunningOrchestrations() {
  try {
    const response = await pacedFetch(daemonUrl("localhost", "orchestration?state=running"), { headers: headers() });
    if (!response.ok) return;
    const body = (await response.json()) as {
      items?: (OrchestrationItem & { node?: string; path?: string; expect?: string; started_at?: string })[];
    };
    for (const item of body.items ?? []) {
      if (!item.orchestration_id || item.state !== "running" || followed(item.orchestration_id)) continue;
      const started = item.started_at ? Date.parse(item.started_at) : NaN;
      follow({
        orchestrationId: item.orchestration_id,
        action: expectAction(item.expect),
        subject: item.path || item.node || "",
        node: item.node,
        path: item.path,
        ...(Number.isNaN(started) ? {} : { startedAt: started }),
      });
    }
  } catch {
    // The events say the next ones.
  }
}

/** What a monitor, of an instance or of a node, says of the orchestration it runs. */
export interface MonitorOrchestration {
  /** The object of an instance monitor; none for a node monitor. */
  path?: string;
  node: string;
  globalExpect?: string | null;
  orchestrationId?: string | null;
  /** Since when it expects it: when the orchestration started. */
  since?: string | null;
  /** Its part of the orchestration done, the others' to end it. */
  done?: boolean;
}

const NIL_ID = "00000000-0000-0000-0000-000000000000";

/** The orchestration the monitor runs, if it runs one. */
const runningId = (monitor: MonitorOrchestration) =>
  monitor.globalExpect && monitor.globalExpect !== "none" && monitor.orchestrationId && monitor.orchestrationId !== NIL_ID && !monitor.done
    ? monitor.orchestrationId
    : null;

/**
 * The orchestrations followed whose reads the daemon refuses (root only): their end
 * said by their event, `…OrchestrationEnd`, the entry ids.
 */
const unread = new Set<string>();
/** The monitors last said by the stream of the cluster. */
let lastMonitors: MonitorOrchestration[] = [];
/** The orchestrations unread no monitor runs any more, the check of their end due. */
const unseen = new Map<string, ReturnType<typeof setTimeout>>();
/**
 * How long an orchestration unread no monitor runs any more waits for the event of
 * its end, which the daemon sends after the monitors let it go: not come by then
 * (missed, the stream closed meanwhile), it ended unknown how.
 */
export const END_EVENT_GRACE_MS = 15_000;

const carried = (orchestrationId: string | undefined) =>
  orchestrationId !== undefined && lastMonitors.some((monitor) => runningId(monitor) === orchestrationId);

function checkUnread() {
  for (const id of [...unread]) {
    const entry = useActionTracker.getState().tracked.find((t) => t.id === id);
    if (entry?.state !== "running") {
      unread.delete(id);
      clearTimeout(unseen.get(id));
      unseen.delete(id);
      continue;
    }
    if (carried(entry.followedId)) {
      clearTimeout(unseen.get(id));
      unseen.delete(id);
      continue;
    }
    if (unseen.has(id)) continue;
    unseen.set(
      id,
      setTimeout(() => {
        unseen.delete(id);
        const still = useActionTracker.getState().tracked.find((t) => t.id === id);
        if (still?.state !== "running" || carried(still.followedId)) return;
        unread.delete(id);
        update(id, { state: "unknown", error: "gone", endedAt: Date.now() });
      }, END_EVENT_GRACE_MS),
    );
  }
}

/**
 * The orchestrations the monitors of the cluster run, as the stream of the cluster
 * says them, its cache first: those running before the page opened, or while its
 * stream was closed, followed as the others, whatever the user may read (the list
 * of the daemon, followRunningOrchestrations, is root's only). An object's said by
 * each of its instances, followed once; a node's by its node. Those followed unread
 * that no monitor runs any more ended, their end event missed (checkUnread).
 */
export function observeMonitors(monitors: MonitorOrchestration[]) {
  lastMonitors = monitors;
  for (const monitor of monitors) {
    const orchestrationId = runningId(monitor);
    if (!orchestrationId || endedIds.has(orchestrationId) || followed(orchestrationId)) continue;
    const started = monitor.since ? Date.parse(monitor.since) : NaN;
    follow({
      orchestrationId,
      action: expectAction(monitor.globalExpect),
      subject: monitor.path || monitor.node,
      // An object's answered for by any node; a node's by itself.
      ...(monitor.path ? { path: monitor.path } : { node: monitor.node }),
      ...(Number.isNaN(started) ? {} : { startedAt: started }),
    });
  }
  checkUnread();
}
