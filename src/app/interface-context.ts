import type { CheckedRows } from "./checked-rows";
import { parseStep } from "./peek";

/**
 * The context of the interface a prompt goes with (AG-UI `context`): what the page
 * under the dock shows, so that a question such as "why is it down?" needs no name.
 * Read from the URL only, as `panel-search.ts` keeps it: the page, the record open
 * in its panel or looked at over it, and their tab. Never the text of a record, an
 * alert or a log line: other people wrote it, and the agent must not take it as the
 * user's word. The URL may come from a link someone else wrote, too: only values
 * shaped as what they name go, a page, an identifier or the name of a tab, short and
 * with no space, and the others are left out.
 *
 * With them, what the user did or set in their session, never the content of a
 * record: the rows they ticked in the list on display (`checked-rows.ts`), which a
 * link cannot tick, and their time zone and clock, for "an hour ago" or "at 2 pm".
 *
 * On the page of the assistant nothing is under the conversation: the session only.
 */
export interface InterfaceEntry {
  description: string;
  value: string;
}

/** The bounds of the agent: past them, it refuses the run (`invalid_context`). */
export const MAX_CONTEXT_ENTRIES = 8;
const MAX_DESCRIPTION_BYTES = 128;
const MAX_VALUE_BYTES = 1024;
const MAX_CONTEXT_BYTES = 4096;

/** What the row open in the panel of a view is, by the path of the view. */
const SELECTED: Readonly<Record<string, string>> = {
  "/objects": "selected object",
  "/nodes": "selected node",
  "/network": "selected network",
  "/pools": "selected pool",
  "/stores": "selected store",
  "/namespaces": "selected namespace",
};

const bytes = (text: string) => new TextEncoder().encode(text).length;

/** A page of the webapp: one segment, as its routes are. */
const PAGE = /^\/[a-z][a-z0-9-]{0,31}$/;
/**
 * The identifier of a record: an object path (`ns/kind/name`), a node, a network, a
 * pool, a namespace, an instance (`path@node`) or a resource (`path:rid@node`).
 */
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@#/+-]{0,255}$/;
/** A store declared in a secret, as `store-config.ts` reads its reference. */
const STORE_REFERENCE = /^from [A-Za-z0-9][A-Za-z0-9._/-]{0,127} store#[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** The name of a tab or of a view within it. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** An IANA time zone, such as `Europe/Paris`. */
const TIME_ZONE = /^[A-Za-z0-9_+/-]{1,64}$/;

/** What the user did or set in their session, besides the page. */
export interface InterfaceSession {
  /** Their clock, when the question is asked. */
  now?: Date;
  /** Their time zone, as the browser tells it. */
  timeZone?: string;
  /** The rows ticked in the list on display. */
  checked?: CheckedRows | null;
}

/** `date` in ISO 8601, to the second, at the offset of the browser: 2026-11-16T15:40:12+01:00. */
export function localTime(date: Date): string {
  const pad = (value: number) => String(Math.trunc(Math.abs(value))).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${offset < 0 ? "-" : "+"}${pad(offset / 60)}:${pad(offset % 60)}`
  );
}

/**
 * The rows ticked, all of them or none: a list cut to the bounds would have an
 * action asked of "these" run on a part of them. Past the bounds, or with an id not
 * shaped as one, their count alone goes, for the assistant to ask which.
 */
function checkedEntries(checked: CheckedRows): InterfaceEntry[] {
  const count = { description: `checked ${checked.kind} count`, value: String(checked.ids.length) };
  const list = checked.ids.join(" ");
  const kind = checked.kind === "nodes" ? "node" : "object";
  if (bytes(list) > MAX_VALUE_BYTES || !checked.ids.every((id) => identifier(kind, id))) return [count];
  return [{ description: `checked ${checked.kind}`, value: list }, count];
}

function sessionEntries({ now, timeZone }: InterfaceSession): InterfaceEntry[] {
  const entries: InterfaceEntry[] = [];
  if (timeZone !== undefined && TIME_ZONE.test(timeZone)) entries.push({ description: "time zone", value: timeZone });
  if (now !== undefined && !Number.isNaN(now.getTime())) entries.push({ description: "local time", value: localTime(now) });
  return entries;
}

const identifier = (kind: string, value: string | undefined) =>
  value !== undefined && (IDENTIFIER.test(value) || (kind === "store" && STORE_REFERENCE.test(value)));
const name = (value: string | undefined) => value !== undefined && NAME.test(value);

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** An entry the agent takes: printable text within its bounds. */
function valid(entry: InterfaceEntry): boolean {
  return (
    entry.description.trim() !== "" &&
    bytes(entry.description) <= MAX_DESCRIPTION_BYTES &&
    bytes(entry.value) <= MAX_VALUE_BYTES &&
    !CONTROL.test(entry.description) &&
    !CONTROL.test(entry.value)
  );
}

/**
 * The entries an agent takes, in their order: an invalid entry is left out, and
 * those past the bounds of the whole, so that a prompt is never refused for them.
 */
export function boundContext(entries: readonly InterfaceEntry[]): InterfaceEntry[] {
  const kept: InterfaceEntry[] = [];
  let total = 0;
  for (const entry of entries) {
    if (kept.length === MAX_CONTEXT_ENTRIES) break;
    if (typeof entry?.description !== "string" || typeof entry?.value !== "string" || !valid(entry)) continue;
    const size = bytes(entry.description) + bytes(entry.value);
    if (total + size > MAX_CONTEXT_BYTES) continue;
    total += size;
    kept.push({ description: entry.description, value: entry.value });
  }
  return kept;
}

/** The context of the page at `pathname`, with the parameters of its address, and of the session. */
export function interfaceContext(pathname: string, search: URLSearchParams, session: InterfaceSession = {}): InterfaceEntry[] {
  if (pathname === "/ai" || pathname.startsWith("/ai/")) return boundContext(sessionEntries(session));
  const read = (key: string) => {
    const value = search.get(key);
    return value === null || value === "" ? undefined : value;
  };
  const entries: InterfaceEntry[] = [];
  if (PAGE.test(pathname)) entries.push({ description: "page", value: pathname });
  // One drawer at a time: the row panel wins over the record looked at.
  const sel = read("sel");
  const peek = sel === undefined ? parseStep(read("peek")) : null;
  let open = false;
  if (sel !== undefined) {
    const selected = SELECTED[pathname] ?? "selected record";
    if (identifier(selected.slice("selected ".length), sel)) {
      entries.push({ description: selected, value: sel });
      open = true;
      const tab = read("tab");
      if (name(tab)) entries.push({ description: "open tab", value: tab! });
    }
  } else if (peek && identifier(peek.kind, peek.id)) {
    entries.push({ description: `open ${peek.kind}`, value: peek.id });
    open = true;
    const tab = read("peektab");
    if (name(tab)) entries.push({ description: "open tab", value: tab! });
  }
  const view = read("view");
  if (open && name(view)) entries.push({ description: "open view", value: view! });
  if (session.checked && session.checked.ids.length > 0) entries.push(...checkedEntries(session.checked));
  entries.push(...sessionEntries(session));
  return boundContext(entries);
}
