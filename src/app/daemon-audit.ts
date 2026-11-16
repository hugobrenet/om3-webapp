/**
 * The audit of a node daemon, as `om daemon audit` reads it: the log records of
 * the subsystems named, up to debug and trace, streamed by the daemon for as long
 * as the request is open (POST /api/node/name/{node}/daemon/audit). One audit at a
 * time on a daemon: another is refused (409) unless it preempts the one running,
 * which then ends on a "preempted" event, and is not opened again, for the two
 * not to preempt each other for ever.
 */

import { splitPrefixes } from "../components/logPrefixes";

/** The levels an audit reads from, the most verbose first, as om takes them. */
export const AUDIT_LEVELS = ["trace", "debug", "info", "warn", "error"] as const;
export type AuditLevel = (typeof AUDIT_LEVELS)[number];

/**
 * The subsystems an audit selects, as om3 names them (commoncmd.AuditSubsystems).
 * A name is a glob pattern; those ending with a colon take a suffix: an object
 * path for icfg, imon and omon ("imon:prod/svc/web"), a heartbeat id for hb.
 */
export const AUDIT_SUBSYSTEMS = [
  "api",
  "api.inet",
  "api.ux",
  "ccfg",
  "collector",
  "cstat",
  "daemonauth",
  "daemondata",
  "discover",
  "dns",
  "drbdmon",
  "virtmon",
  "ctrmon",
  "mdmon",
  "hb",
  "hb.ctrl",
  "hb.main",
  "hb.peer_dropper",
  "hb:",
  "hook",
  "icfg",
  "icfg:",
  "imon",
  "imon:",
  "istat",
  "mntmon",
  "netmon",
  "nmon",
  "omon",
  "omon:",
  "pubsub",
  "runner",
  "scheduler",
];

/** The subsystems whose suffix is an object path. */
const OBJECT_SUFFIXED = ["icfg", "imon", "omon"];

/** The suggestions shown at most: typing narrows them. */
const MAX_SUGGESTIONS = 50;

/** A suggestion of the subsystem field: chosen, `value` is added, or, `partial`, written for its suffix. */
export interface SubsystemSuggestion {
  value: string;
  partial: boolean;
}

/**
 * What the subsystem field suggests for the text typed, the ones chosen apart: the
 * known names containing it, those taking a suffix to complete ("imon:"); once such
 * a name is written, "imon:*" and the object paths given containing what follows it.
 */
export function subsystemSuggestions(typed: string, chosen: string[], paths: string[]): SubsystemSuggestion[] {
  const query = typed.trim().toLowerCase();
  const fresh = (value: string) => !chosen.includes(value);
  const suffixed = /^([a-z]+):(.*)$/.exec(query);
  if (suffixed && OBJECT_SUFFIXED.includes(suffixed[1])) {
    const [, name, rest] = suffixed;
    return [`${name}:*`, ...[...paths].sort().filter((path) => path.toLowerCase().includes(rest)).map((path) => `${name}:${path}`)]
      .filter(fresh)
      .slice(0, MAX_SUGGESTIONS)
      .map((value) => ({ value, partial: false }));
  }
  return AUDIT_SUBSYSTEMS.filter((name) => name.includes(query) && fresh(name))
    .slice(0, MAX_SUGGESTIONS)
    .map((value) => ({ value, partial: value.endsWith(":") }));
}

/** The event the daemon ends an audit with when another session preempted it. */
export const AUDIT_PREEMPTED = "preempted";

/** The subsystems written in a field: separated by blanks or commas, none for all of them. */
export function parseSubsystems(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).filter(Boolean))];
}

/** The address of the audit of a node: its level, its subsystems repeated, none for all. */
export function auditUrl(
  base: string,
  node: string,
  { level, subsystems, preempt }: { level: AuditLevel; subsystems: string[]; preempt?: boolean },
): string {
  const query = new URLSearchParams({ level });
  for (const sub of subsystems) query.append("sub", sub);
  if (preempt) query.set("preempt", "true");
  return `${base}/${encodeURIComponent(node)}/daemon/audit?${query}`;
}

/** An event of the stream: its name, empty for a record, and its data. */
export interface StreamEvent {
  event: string;
  data: string;
}

/**
 * A reader of a server-sent event stream fed as it comes: each chunk read, the
 * events it completes. A field is a line "name:value", the value after one blank
 * at most; a blank line ends an event; data lines of an event joined by newlines.
 */
export function eventStreamParser(): (chunk: string) => StreamEvent[] {
  let buffer = "";
  let event = "";
  let data: string[] = [];
  return (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r\n|\r|\n/);
    buffer = lines.pop() ?? "";
    const events: StreamEvent[] = [];
    for (const line of lines) {
      if (line === "") {
        if (data.length > 0) events.push({ event, data: data.join("\n") });
        event = "";
        data = [];
        continue;
      }
      const colon = line.indexOf(":");
      if (colon === 0) continue; // A comment.
      const name = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (name === "event") event = value;
      else if (name === "data") data.push(value);
    }
    return events;
  };
}

/** A record of an audit: when, how important, and what, its prefixes apart. */
export interface AuditRecord {
  id: number;
  time: Date;
  level: string;
  message: string;
  prefixes: string[];
  text: string;
}

/**
 * The record a data line holds, `{level, message, time}`: the message without
 * the node the daemon puts first, the node being the one audited.
 */
export function auditRecordOf(data: string, node: string, id: number): AuditRecord | null {
  let record: { level?: unknown; message?: unknown; time?: unknown };
  try {
    record = JSON.parse(data);
  } catch {
    return null;
  }
  if (record === null || typeof record !== "object") return null;
  const full = typeof record.message === "string" ? record.message : "";
  const message = full.startsWith(`${node}: `) ? full.slice(node.length + 2) : full;
  const time = new Date(typeof record.time === "string" ? record.time : Date.now());
  return {
    id,
    time: Number.isNaN(time.getTime()) ? new Date() : time,
    level: typeof record.level === "string" ? record.level : "info",
    message,
    ...splitPrefixes(message),
  };
}

/** The records as text, a line each, as `om daemon audit` writes them. */
export function auditText(records: AuditRecord[]): string {
  return records.map((r) => `${r.time.toISOString()} ${r.level.toUpperCase()} ${r.message}`).join("\n") + "\n";
}
