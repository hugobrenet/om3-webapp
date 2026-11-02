/*
 * Why an object is not up, in a line, for the lists: the first warning or error its
 * status board says (`statusboard.ts`), read from what the event stream holds of it,
 * no request of its own; none, its instances stopped on purpose, then a vol's
 * children down, then its resources down, then what else it says (frozen). An object
 * up and provisioned, or of no status (a configuration, a secret), no reason.
 */
import { buildBoard, type InstanceStates, type NoteFix, type ObjectData } from "./statusboard";

export interface Reason {
  level: "error" | "warn" | "info";
  text: string;
  /** The other notes worth a look, warnings and errors, the panel says. */
  more: number;
  /** The action its note asks for, as the status board offers it. */
  fix?: NoteFix;
}

/** What the event stream holds of an object, as the store keeps it. */
export interface ObjectEvents {
  object: Record<string, unknown> | undefined;
  /** The status of each instance, by node. */
  instances: Record<string, Record<string, unknown> | undefined> | undefined;
  /** The monitor of each instance, by node. */
  monitors: Record<string, Record<string, unknown> | undefined>;
  /** The configuration of each instance, by node. */
  configs: Record<string, Record<string, unknown> | undefined> | undefined;
}

/** An object worth a reason: its availability down or warn, its overall warn, or not provisioned, or partly. */
export const needsReason = (object: Record<string, unknown> | undefined): boolean => {
  const avail = object?.avail;
  const provisioned = object?.provisioned;
  return avail === "down" || avail === "warn" || object?.overall === "warn" ||
    provisioned === "false" || provisioned === false || provisioned === "mixed";
};

/** The notes of the object whose text says not what they are about: said with it. */
const NAMED_SUBJECTS: ReadonlySet<string> = new Set(["frozen", "node frozen"]);

/** The resources shown down at most, the others counted. */
const RIDS_MAX = 3;

/** The resources down on the instances, not optional, by name, once each. */
function resourcesDown(instances: ObjectEvents["instances"]): string[] {
  const rids = new Set<string>();
  for (const status of Object.values(instances ?? {})) {
    const resources = (status?.resources ?? {}) as Record<string, { status?: string; optional?: boolean }>;
    for (const [rid, r] of Object.entries(resources)) if (r?.status === "down" && !r.optional) rids.add(rid);
  }
  return [...rids].sort();
}

/** The reason an object is not up, or null: up, of no status, or nothing to say. */
export function objectReason(path: string, events: ObjectEvents): Reason | null {
  if (!needsReason(events.object)) return null;
  const nodes = [...new Set([...Object.keys(events.instances ?? {}), ...Object.keys(events.configs ?? {})])];
  const instances: Record<string, InstanceStates> = {};
  for (const node of nodes) {
    instances[node] = {
      status: events.instances?.[node],
      monitor: events.monitors[node],
      config: events.configs?.[node],
    } as InstanceStates;
  }
  const board = buildBoard({ path, object: { ...(events.object as ObjectData), instances } });
  const down = resourcesDown(events.instances);
  const subjectOf = (g: (typeof board.notes)[number]) => g.heads[0]?.subject ?? "";
  // A warning or an error first; infos only, the instances stopped on purpose, or a
  // vol's children down, which say why it is down, then its resources down, before
  // the others (frozen…).
  const pick =
    board.notes.find((g) => g.level !== "info") ??
    board.notes.find((g) => subjectOf(g) === "stopped") ??
    board.notes.find((g) => subjectOf(g) === "children") ??
    (down.length > 0 ? undefined : board.notes[0]);
  if (pick !== undefined) {
    const head = pick.heads[0];
    // A note about a resource said with its name, one of a freeze with its word; the others say it.
    const aboutResource = head !== undefined && head.marker !== "" && head.marker !== "·";
    const named = aboutResource || NAMED_SUBJECTS.has(subjectOf(pick));
    return {
      level: pick.level,
      text: named ? `${subjectOf(pick)}: ${pick.text}` : pick.text,
      more: board.notes.filter((g) => g !== pick && g.level !== "info").length,
      ...(pick.fix ? { fix: pick.fix } : {}),
    };
  }
  if (down.length === 0) return null;
  const shown = down.slice(0, RIDS_MAX).join(", ");
  return {
    level: "error",
    text: down.length > RIDS_MAX ? `${shown}… down` : `${shown} down`,
    more: 0,
  };
}

/**
 * The reason of an object, kept while what it is read from does not change: a list
 * asks it of every row at each event of the stream.
 */
const cache = new Map<string, { inputs: unknown[]; reason: Reason | null }>();

export function cachedReason(path: string, events: ObjectEvents): Reason | null {
  const inputs = [events.object, events.instances, events.configs, ...Object.entries(events.monitors).flat()];
  const hit = cache.get(path);
  if (hit && hit.inputs.length === inputs.length && hit.inputs.every((v, i) => v === inputs[i])) return hit.reason;
  const reason = objectReason(path, events);
  cache.set(path, { inputs, reason });
  return reason;
}
