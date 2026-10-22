/**
 * The status of an object cluster-wide, as `om <path> status` renders it (om3
 * `core/statusboard`), ported to give a model the page renders rather than text:
 * a board of the resources by node, the instance states above it, and below it
 * the notes saying what needs attention.
 *
 * The resources are rows, in the order the actions run them, grouped by subset,
 * and the nodes are columns. A cell holds the status of the resource on the node,
 * the flags departing from the usual, and the markers of the notes about it. What
 * the label of a resource says the same on every node stays in the description
 * column, and what differs goes on rows of its own under it, "@<node> <value>".
 *
 * The rules are om's: keep them in step with `core/statusboard/main.go`.
 */

/** How a piece of the board is colored, as om colorizes it. */
export type Tone = "optimal" | "error" | "warning" | "secondary" | "primary" | "frozen";

/**
 * A piece of the board: its text as om writes it, colored or not, and what it
 * means, for the page to draw it as the rest of the webapp does.
 */
export interface Span {
  text: string;
  tone?: Tone;
  bold?: boolean;
  /** The status an icon stands for: "up", "down", "stdby up", "n/a"… */
  status?: string;
  /** An instance mark: "!", "R", "L", "#", "^", "*", "=", "P". */
  mark?: string;
  /** A resource flag: R, M, D, O, E, P, S, X, or the restarts remaining. */
  flag?: boolean;
  /** The marker of a note. */
  note?: boolean;
}

/** A cell, a value, a head: the pieces it is made of. */
export type Text = Span[];

/** What a row is: a state of the instances, the heading of the resources, a resource… */
export type RowKind =
  | "instance"
  | "monitor"
  | "expect"
  | "provisioned"
  | "orchestration"
  | "resources"
  | "subset"
  | "resource"
  | "label"
  | "blank";

/** A note as a cell or a row shows it on hover: the nodes empty in a cell, said there. */
export interface RowNote {
  marker: string;
  level: Level;
  text: string;
  /** The nodes the note is about: "all", their names, or none. */
  nodes: string;
}

export interface BoardRow {
  kind: RowKind;
  /** An empty line between the parts of the board. */
  blank?: boolean;
  /** Depth of the name: a part of a row (monitor), a resource, a resource of a subset. */
  indent: number;
  name: string;
  /** A row named by an identifier, a resource or a subset: in bold. */
  ident: boolean;
  typ: string;
  cells: Text[];
  desc: Text;
  /**
   * The notes about each cell: the messages of the resource on the node, or, for
   * the instance row, the notes about the instance of the node.
   */
  cellNotes: RowNote[][];
  /** The notes about the row: the resource on any node, the instances. */
  rowNotes: RowNote[];
}

export interface NoteHead {
  marker: string;
  subject: string;
  /** The nodes the note is about: "all", their names, or none. */
  nodes: string;
}

export interface NoteGroup {
  level: Level;
  heads: NoteHead[];
  text: string;
}

export type FactName = "topology" | "orchestrate" | "placement";
export interface Fact {
  name: FactName;
  value: string;
}

export interface Board {
  path: string;
  /** Topology, orchestrate, placement policy: each named, for its tag to tell which. */
  facts: Fact[];
  /** The fields of the head: avail, overall, and the states worth saying. */
  fields: { name: string; value: Text }[];
  nodes: { name: string; frozen: boolean }[];
  rows: BoardRow[];
  notes: NoteGroup[];
  /** The info notes beyond the ones listed. */
  moreInfos: number;
}

export type Level = "error" | "warn" | "info";

/* The data, as the daemon API serves it (GET /api/object/path/{ns}/{kind}/{name}). */

export interface ResourceStatus {
  label?: string;
  log?: { level?: string; message?: string }[];
  status?: string;
  type?: string;
  provisioned?: { state?: string };
  monitor?: boolean;
  disable?: boolean;
  optional?: boolean;
  encap?: boolean;
  standby?: boolean;
  stopped?: boolean;
  subset?: string;
  rpo_breached_at?: string;
}

export interface InstanceStatus {
  avail?: string;
  overall?: string;
  provisioned?: string;
  frozen_at?: string;
  stopped_at?: string;
  rpo_breached_at?: string;
  resources?: Record<string, ResourceStatus>;
  encap?: Record<string, { resources?: Record<string, ResourceStatus>; running?: unknown[] }>;
  running?: { rid?: string }[];
}

export interface InstanceConfig {
  topology?: string;
  orchestrate?: string;
  drp?: boolean;
  resources?: Record<string, { restart?: number }>;
  subsets?: Record<string, { parallel?: boolean }>;
}

export interface InstanceMonitor {
  state?: string;
  global_expect?: string;
  local_expect?: string;
  is_ha_leader?: boolean;
  is_leader?: boolean;
  orchestration_id?: string;
  updated_at?: string;
  resources?: Record<string, { restart?: { remaining?: number } }>;
}

export interface InstanceStates {
  config?: InstanceConfig;
  monitor?: InstanceMonitor;
  status?: InstanceStatus;
}

export interface ObjectData {
  avail?: string;
  overall?: string;
  frozen?: string;
  provisioned?: string;
  placement_state?: string;
  placement_policy?: string;
  topology?: string;
  orchestrate?: string;
  up_instances_count?: number;
  flex?: { min?: number; max?: number; target?: number };
  scope?: string[];
  instances?: Record<string, InstanceStates>;
}

export interface Digest {
  path: string;
  object: ObjectData;
  /** The nodes frozen, as the cluster status says. */
  frozenNodes?: ReadonlySet<string>;
  /** Whether the nodes run compatible agent versions; true when unknown. */
  isCompat?: boolean;
}

/** Infos listed, beyond which they are counted: the warnings and errors stay. */
const INFO_MAX = 10;

const SUPERSCRIPTS = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/** Marks the notes beyond the ninth, so a marker stays one glyph. */
const SUPERSCRIPT_LETTERS = [..."ᴬᴮᴰᴱᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾᴿᵀᵁⱽᵂ"];

/** The order the actions run the driver groups in, an unknown one first. */
const DRIVER_GROUPS = ["ip", "volume", "disk", "fs", "share", "container", "app", "sync", "task"];

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

const span = (text: string, tone?: Tone, extra: Partial<Span> = {}): Span => ({
  text,
  ...(tone === undefined ? {} : { tone }),
  ...extra,
});

/** A time the API gives, zero when absent or Go's zero time. */
function isZeroTime(value: string | undefined): boolean {
  return value === undefined || value === "" || value.startsWith("0001-01-01");
}

function isPast(value: string | undefined): boolean {
  return !isZeroTime(value) && Date.parse(value as string) < Date.now();
}

function driverGroup(rid: string): string {
  return rid.split("#")[0] ?? "";
}

function groupRank(group: string): number {
  const i = DRIVER_GROUPS.indexOf(group);
  return i < 0 ? -1 : i;
}

/** The resources of an instance in the order the actions run them: group, subset, name. */
function sortedResources(resources: Record<string, ResourceStatus> | undefined) {
  return Object.entries(resources ?? {})
    .filter(([rid]) => rid.includes("#"))
    .map(([rid, rs]) => ({ rid, rs }))
    .sort((a, b) => {
      const ga = groupRank(driverGroup(a.rid));
      const gb = groupRank(driverGroup(b.rid));
      if (ga !== gb) return ga - gb;
      const sa = a.rs.subset ?? "";
      const sb = b.rs.subset ?? "";
      if (sa !== sb) return sa < sb ? -1 : 1;
      return a.rid < b.rid ? -1 : a.rid > b.rid ? 1 : 0;
    });
}

const isActor = (s: InstanceStates) => s.config !== undefined && "resources" in s.config;
const isFrozen = (s: InstanceStates) => !isZeroTime(s.status?.frozen_at);
const isStopped = (s: InstanceStates) => !isZeroTime(s.status?.stopped_at);
const isUnprovisioned = (s: InstanceStates) =>
  s.status?.provisioned === "false" || s.status?.provisioned === "mixed";
const isSet = (v: string | undefined) => v !== undefined && v !== "" && v !== "none" && v !== "init";
const hasExpect = (s: InstanceStates) =>
  isSet(s.monitor?.global_expect) || isSet(s.monitor?.local_expect);

/** The words of a label: at the spaces, and after a "@" joining a device to its mount point. */
export function words(label: string): string[] {
  const out: string[] = [];
  for (let w of label.split(/\s+/).filter((x) => x !== "")) {
    for (;;) {
      const i = w.indexOf("@");
      if (i < 0 || i === w.length - 1) break;
      out.push(w.slice(0, i + 1));
      w = w.slice(i + 1);
    }
    out.push(w);
  }
  return out;
}

function joinWords(l: string[]): string {
  return l.reduce((s, w, i) => s + (i > 0 && !(l[i - 1] as string).endsWith("@") ? " " : "") + w, "");
}

/**
 * The words of the labels the nodes share, in the order of the first label, and by
 * node the words of its label the others do not all have.
 */
export function splitLabels(nodes: string[], labels: Map<string, string>) {
  const varying = new Map<string, string>();
  const byNode = new Map<string, string[]>();
  let ref: string[] | undefined;
  for (const node of nodes) {
    const label = labels.get(node);
    if (label === undefined) continue;
    const l = words(label);
    byNode.set(node, l);
    ref ??= l;
  }
  const isCommon = (w: string) => [...byNode.values()].every((l) => l.includes(w));
  for (const [node, l] of byNode) varying.set(node, joinWords(l.filter((w) => !isCommon(w))));
  return { common: joinWords((ref ?? []).filter(isCommon)), varying };
}

/** The marker of the n-th note: ¹ to ⁹, then ᴬ to ᵂ, then the numbers following. */
export function marker(n: number): string {
  if (n > 9 && n - 10 < SUPERSCRIPT_LETTERS.length) return SUPERSCRIPT_LETTERS[n - 10] as string;
  return [...String(n)].map((c) => SUPERSCRIPTS[Number(c)]).join("");
}

interface Note {
  id: number;
  marker: string;
  level: Level;
  /** The resource, or what the note is about: monitor, frozen… */
  subject: string;
  nodes: string[];
  text: string;
  /** A note a resource logged, which the cells point to. */
  fromResource: boolean;
}

/** A piece of a cell standing for the markers of notes, numbered once the notes are. */
interface MarkerRef {
  notes: Note[];
}

type Piece = Span | MarkerRef;
const isRef = (p: Piece): p is MarkerRef => "notes" in p;

const toLevel = (level: string | undefined): Level =>
  level === "error" || level === "warn" ? level : "info";

const LEVEL_TONE: Record<Level, Tone> = { error: "error", warn: "warning", info: "secondary" };

export function buildBoard(digest: Digest): Board {
  const obj = digest.object;
  /** The object is an actor, a service or a volume: it has a status of its own. */
  const actor = obj.avail !== undefined;
  const states = obj.instances ?? {};
  const frozenNodes = digest.frozenNodes ?? new Set<string>();

  // The nodes of the scope, the order its placement policy reads them in, then the
  // nodes out of the scope reporting an instance anyway. A node of the scope with
  // no instance has its column, empty.
  const scope = obj.scope ?? [];
  const nodes = [...scope, ...Object.keys(states).filter((n) => !scope.includes(n)).sort()];
  const stateOf = (node: string): InstanceStates => states[node] ?? {};
  const cellsOf = (fn: (s: InstanceStates, node: string) => Piece[]) => nodes.map((n) => fn(stateOf(n), n));
  const anyNode = (fn: (s: InstanceStates) => boolean) => nodes.some((n) => fn(stateOf(n)));
  const nodesWith = (fn: (s: InstanceStates) => boolean) => nodes.filter((n) => fn(stateOf(n)));

  const expected = !actor ? 0 : obj.flex !== undefined ? (obj.flex.target ?? 0) : 1;
  const up = obj.up_instances_count ?? 0;
  const allowed = !actor
    ? 0
    : obj.topology === "failover"
      ? 1
      : obj.topology === "flex" && obj.flex !== undefined
        ? (obj.flex.max ?? 0)
        : 0;
  const excess = allowed <= 0 || up <= allowed ? 0 : up - allowed;
  const hasExpectedInstances = actor && up >= Math.max(1, expected);

  /** A status as the om mon icon says it; a down is gray where no instance is missing. */
  const statusIcon = (st: string | undefined): Span => {
    const status = { status: st === undefined || st === "" ? "undef" : st };
    const issue = (icon: string) => span(icon, hasExpectedInstances ? "secondary" : "error", status);
    switch (st) {
      case "up":
        return span("O", "optimal", status);
      case "down":
        return issue("X");
      case "stdby up":
        return issue("o");
      case "stdby down":
        return span("x", "error", status);
      case "warn":
        return span("!", "warning", status);
      case "n/a":
        return span("/", "secondary", status);
      case "undef":
      case undefined:
      case "":
        return span("?", "error", status);
      default:
        return span(st, undefined, status);
    }
  };

  /** The marks om mon puts after the icon of an instance, in its order. */
  const instanceMarks = (s: InstanceStates): Span[] => {
    const marks: Span[] = [];
    const mark = (text: string, tone: Tone) => marks.push(span(text, tone, { mark: text }));
    if (s.status?.overall === "warn") mark("!", "warning");
    const running =
      (s.status?.running?.length ?? 0) > 0 ||
      Object.values(s.status?.encap ?? {}).some((e) => (e.running?.length ?? 0) > 0);
    if (running) mark("R", "frozen");
    if (isPast(s.status?.rpo_breached_at)) mark("L", "error");
    if (s.config?.drp) mark("#", "secondary");
    if (s.monitor?.is_ha_leader) mark("^", obj.placement_state === "non-optimal" ? "error" : "secondary");
    if (isFrozen(s)) mark("*", "frozen");
    if (isStopped(s)) mark("=", "secondary");
    if (isUnprovisioned(s)) mark("P", "error");
    return marks;
  };

  type PieceRow = Omit<BoardRow, "cells" | "desc" | "cellNotes" | "rowNotes"> & { cells: Piece[][]; desc: Text };
  const rows: PieceRow[] = [];
  const row = (r: Partial<PieceRow> & { name: string; kind: RowKind }): PieceRow => ({
    indent: 0,
    ident: false,
    typ: "",
    cells: nodes.map(() => []),
    desc: [],
    ...r,
  });

  const notes: Note[] = [];
  const noteByKey = new Map<string, Note>();
  const noteOf = (rid: string, node: string, level: Level, text: string): Note => {
    const key = `${rid}\0${level}\0${text}`;
    let n = noteByKey.get(key);
    if (n === undefined) {
      n = { id: notes.length, marker: "", level, subject: rid, nodes: [], text, fromResource: true };
      noteByKey.set(key, n);
      notes.push(n);
    }
    if (!n.nodes.includes(node)) n.nodes.push(node);
    return n;
  };

  // The instance states.
  let count: Text = [];
  if (actor && obj.avail !== "n/a") {
    const text = expected === 0 ? String(up) : `${up}/${expected}`;
    count = [span(text, excess > 0 ? "error" : undefined)];
  }
  rows.push(row({ kind: "instance", name: "instance", desc: count, cells: cellsOf((s) => [statusIcon(s.status?.avail), ...instanceMarks(s)]) }));
  rows.push(
    row({
      kind: "monitor",
      name: "monitor",
      indent: 1,
      cells: cellsOf((s) => {
        const state = s.monitor?.state ?? "";
        if (isZeroTime(s.monitor?.updated_at)) return [span("no-monitor", "warning")];
        if (state === "idle") return [span(state, "secondary")];
        if (state.endsWith("failed")) return [span(state, "error")];
        return [span(state, "primary")];
      }),
    }),
  );
  if (anyNode(hasExpect)) {
    rows.push(
      row({
        kind: "expect",
        name: "expect",
        indent: 1,
        cells: cellsOf((s) => {
          const l: string[] = [];
          if (isSet(s.monitor?.global_expect)) l.push(`>${s.monitor?.global_expect ?? ""}`);
          if (isSet(s.monitor?.local_expect)) l.push(s.monitor?.local_expect ?? "");
          return l.length === 0 ? [span("·", "secondary")] : [span(l.join(" "))];
        }),
      }),
    );
  }
  if (anyNode((s) => isActor(s) && isUnprovisioned(s))) {
    rows.push(
      row({
        kind: "provisioned",
        name: "provisioned",
        indent: 1,
        cells: cellsOf((s) => {
          const v = s.status?.provisioned ?? "";
          return [span(v, v === "true" || v === "n/a" ? "secondary" : "error")];
        }),
      }),
    );
  }
  const orchestration = (s: InstanceStates) => {
    const id = s.monitor?.orchestration_id;
    return id !== undefined && id !== "" && id !== ZERO_UUID ? id : undefined;
  };
  if (anyNode((s) => orchestration(s) !== undefined)) {
    rows.push(
      row({
        kind: "orchestration",
        name: "orchestration",
        indent: 1,
        cells: cellsOf((s) => {
          const id = orchestration(s);
          return id === undefined ? [span("·", "secondary")] : [span(id.slice(0, 8))];
        }),
      }),
    );
  }

  /** The flags of a resource on a node departing from the usual, in om's order. */
  const flags = (rid: string, s: InstanceStates, rs: ResourceStatus): Span[] => {
    const l: Span[] = [];
    const flag = (text: string, tone?: Tone) => l.push(span(text, tone, { flag: true }));
    if (s.status?.running?.some((r) => r.rid === rid)) flag("R");
    if (rs.monitor) flag("M");
    if (rs.disable) flag("D");
    if (rs.optional) flag("O");
    if (rs.encap) flag("E");
    if (rs.provisioned?.state === "false") flag("P", "error");
    if (rs.standby) flag("S");
    if (isActor(s)) {
      const restart = s.config?.resources?.[rid]?.restart ?? 0;
      const remaining = s.monitor?.resources?.[rid]?.restart?.remaining ?? 0;
      const f = rs.stopped
        ? "X"
        : restart <= 0
          ? "."
          : remaining <= 0
            ? "0"
            : remaining < 10
              ? String(remaining)
              : "+";
      if (f !== ".") flag(f);
    }
    return l;
  };

  /** The row of a resource, and the rows of the parts of its label differing by node. */
  const resourceRow = (
    indent: number,
    rid: string,
    type: string,
    get: (s: InstanceStates) => ResourceStatus | undefined,
  ) => {
    const labels = new Map<string, string>();
    for (const node of nodes) {
      const rs = get(stateOf(node));
      if (rs !== undefined) labels.set(node, rs.label ?? "");
    }
    const split = splitLabels(nodes, labels);
    const dot = type.indexOf(".");
    const typ = dot < 0 ? type : type.slice(dot + 1);
    const common = (split.common.startsWith(typ) ? split.common.slice(typ.length) : split.common).trim();
    const cells = cellsOf((s, node) => {
      const rs = get(s);
      if (rs === undefined) return [span("·", "secondary")];
      const pieces: Piece[] = [statusIcon(rs.status)];
      const f = flags(rid, s, rs);
      if (f.length > 0) pieces.push(span(" "), ...f);
      const refs: Note[] = [];
      for (const e of rs.log ?? []) refs.push(noteOf(rid, node, toLevel(e.level), e.message ?? ""));
      if (isPast(rs.rpo_breached_at)) {
        const at = rs.rpo_breached_at as string;
        const text =
          Date.parse(at) === 0
            ? "rpo breached: no copy was ever received here, and taking over here would lose all the data"
            : `rpo breached since ${new Date(at).toISOString().replace(/\.\d+Z$/, "Z")}: the copy here is older than the max delay of the resource allows, and taking over here would lose more data`;
        refs.push(noteOf(rid, node, "error", text));
      }
      const unique = refs.filter((n, i) => refs.indexOf(n) === i);
      if (unique.length > 0) pieces.push(span(" "), { notes: unique });
      return pieces;
    });
    rows.push(row({ kind: "resource", name: rid, indent, ident: true, typ, cells, desc: common === "" ? [] : [span(common)] }));
    const byValue = new Map<string, string[]>();
    for (const node of nodes) {
      let v = split.varying.get(node);
      if (v === undefined || v === "") continue;
      v = v.endsWith("@") ? v.slice(0, -1) : v;
      byValue.set(v, [...(byValue.get(v) ?? []), node]);
    }
    for (const [v, l] of byValue) {
      rows.push(row({ kind: "label", name: "", indent, desc: [span(`${l.map((n) => `@${n}`).join(" ")} ${v}`)] }));
    }
  };

  // The resources, in the order the actions run them, from the instance knowing
  // the most of them, followed by the ones only other instances know.
  let order: ReturnType<typeof sortedResources> = [];
  for (const node of nodes) {
    const l = sortedResources(stateOf(node).status?.resources);
    if (l.length > order.length) order = l;
  }
  const seen = new Set(order.map((r) => r.rid));
  for (const node of nodes) {
    for (const r of sortedResources(stateOf(node).status?.resources)) {
      if (!seen.has(r.rid)) {
        seen.add(r.rid);
        order.push(r);
      }
    }
  }
  const firstResource = rows.length;
  let lastSubset = "";
  for (const { rid, rs } of order) {
    let indent = 1;
    if (rs.subset !== undefined && rs.subset !== "") {
      const name = `subset#${driverGroup(rid)}:${rs.subset}`;
      if (name !== lastSubset) {
        const parallel = nodes.some((n) => {
          const s = stateOf(n);
          return isActor(s) && s.config?.subsets?.[name]?.parallel === true;
        });
        rows.push(row({ kind: "subset", name, indent: 1, ident: true, desc: parallel ? [span("//")] : [] }));
      }
      lastSubset = name;
      indent = 2;
    } else {
      lastSubset = "";
    }
    resourceRow(indent, rid, rs.type ?? "", (s) => s.status?.resources?.[rid]);
    if (driverGroup(rid) === "container") {
      // The resources the container runs, as its encapsulated agent reports them.
      const encapOrder: ReturnType<typeof sortedResources> = [];
      const encapSeen = new Set<string>();
      for (const node of nodes) {
        const encap = stateOf(node).status?.encap?.[rid];
        if (encap === undefined) continue;
        for (const r of sortedResources(encap.resources)) {
          if (!encapSeen.has(r.rid)) {
            encapSeen.add(r.rid);
            encapOrder.push(r);
          }
        }
      }
      for (const r of encapOrder) {
        resourceRow(indent + 1, r.rid, r.rs.type ?? "", (s) => s.status?.encap?.[rid]?.resources?.[r.rid]);
      }
    }
  }
  if (rows.length > firstResource) {
    // Under their heading, as the instance states are under the instance row.
    rows.splice(firstResource, 0, row({ kind: "blank", name: "", blank: true }), row({ kind: "resources", name: "resources" }));
  }

  // The notes about the object and its instances, which no resource marker points to.
  const add = (level: Level, subject: string, about: string[], text: string) => {
    notes.push({ id: notes.length, marker: "", level, subject, nodes: about, text, fromResource: false });
  };
  if (excess > 0) {
    add(
      "error",
      "instances",
      nodesWith((s) => s.status?.avail === "up"),
      `${up} instances up, ${obj.topology ?? ""} allows ${allowed}: the shared resources may be written by several nodes at once. Stop the instances in excess.`,
    );
  }
  if (actor && obj.placement_state === "non-optimal") {
    const leaders = nodesWith((s) => s.monitor?.is_leader === true);
    add(
      "warn",
      "placement",
      [],
      leaders.length > 0
        ? `non-optimal: the placement policy prefers ${leaders.join(" ")}`
        : "non-optimal: the instances are not running on the nodes the placement policy prefers",
    );
  }
  const hasResourceIssue = [...noteByKey.values()].some((n) => n.level !== "info");
  if (actor && obj.overall === "warn" && !hasResourceIssue) {
    const l = nodesWith((s) => s.status?.overall === "warn");
    if (l.length > 0) add("warn", "overall", l, "resources are in warn");
  }
  if (digest.isCompat === false) add("error", "agents", [], "the nodes run incompatible agent versions");
  const noMonitor = nodesWith((s) => isZeroTime(s.monitor?.updated_at));
  if (noMonitor.length > 0)
    add("warn", "monitor", noMonitor, "no instance monitor: the daemon is down, or has not started monitoring the instance");
  for (const node of nodesWith((s) => (s.monitor?.state ?? "").endsWith("failed"))) {
    add("error", "monitor", [node], `${stateOf(node).monitor?.state ?? ""}: the orchestration gave up, clear the instance to retry`);
  }
  const frozen = nodesWith(isFrozen);
  if (frozen.length > 0) add("info", "frozen", frozen, "the daemon takes no initiative on the instance");
  const nodeFrozen = nodes.filter((n) => frozenNodes.has(n) && states[n] !== undefined);
  if (nodeFrozen.length > 0)
    add("info", "node frozen", nodeFrozen, "the daemon takes no initiative on the instances of the node");
  const stopped = nodesWith(isStopped);
  if (stopped.length > 0) add("info", "stopped", stopped, "stopped on purpose: the daemon does not start it back");
  const unprovisioned = nodesWith((s) => isActor(s) && isUnprovisioned(s));
  if (unprovisioned.length > 0) add("error", "provisioned", unprovisioned, "the instance is not provisioned, or partly");

  // The notes by level, errors first; the same text at the same level shares a
  // group, and a group with a resource note gets a marker, which its cells show.
  const rank: Record<Level, number> = { error: 0, warn: 1, info: 2 };
  const sorted = notes.map((n, i) => ({ n, i })).sort((a, b) => rank[a.n.level] - rank[b.n.level] || a.i - b.i).map((x) => x.n);
  const groups: { level: Level; text: string; notes: Note[] }[] = [];
  const byText = new Map<string, (typeof groups)[number]>();
  for (const n of sorted) {
    const key = `${n.level}\0${n.text}`;
    let g = byText.get(key);
    if (g === undefined) {
      g = { level: n.level, text: n.text, notes: [] };
      byText.set(key, g);
      groups.push(g);
    }
    g.notes.push(n);
  }
  let numbered = 0;
  for (const g of groups) {
    if (!g.notes.some((n) => n.fromResource)) continue;
    numbered++;
    for (const n of g.notes) n.marker = marker(numbered);
  }
  const position = new Map(sorted.map((n, i) => [n, i]));
  /** Notes once each, in the order of the notes. */
  const ordered = (l: Note[]) =>
    l.filter((n, i) => l.indexOf(n) === i).sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
  const nodesText = (l: string[]) =>
    l.length === 0 ? "" : l.length === nodes.length && nodes.length > 1 ? "all" : l.join(" ");
  const toRowNote = (n: Note): RowNote => ({ marker: n.marker, level: n.level, text: n.text, nodes: nodesText(n.nodes) });
  const resolve = (pieces: Piece[]): Text =>
    pieces.flatMap((p) => {
      if (!isRef(p)) return [p];
      const l = p.notes.filter((n) => n.marker !== "").sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
      return l.map((n) => span(n.marker, LEVEL_TONE[n.level], { note: true }));
    });

  // The head: the path and the policies, then avail, overall and the states worth saying.
  const facts: Fact[] = actor
    ? ([["topology", obj.topology], ["orchestrate", obj.orchestrate], ["placement", obj.placement_policy]] as const)
      .filter(([, value]) => !!value)
      .map(([name, value]) => ({ name, value: value as string }))
    : [];
  const fields: Board["fields"] = [];
  if (actor) {
    fields.push({ name: "avail", value: [statusSpan(obj.avail)] });
    fields.push({ name: "overall", value: [statusSpan(obj.overall)] });
    const st: Span[] = [];
    if (obj.provisioned === "false") st.push(span("not-provisioned", "error"));
    if (obj.provisioned === "mixed") st.push(span("mixed-provisioned", "error"));
    if (obj.frozen === "frozen") st.push(span("frozen", "frozen"));
    if (obj.frozen === "mixed") st.push(span("mixed-frozen", "frozen"));
    if (obj.placement_state === "non-optimal") st.push(span("non-optimal-placement", "warning"));
    if (digest.isCompat === false) st.push(span("incompatible-versions", "error"));
    if (st.length > 0) fields.push({ name: "state", value: st.flatMap((s, i) => (i === 0 ? [s] : [span(", "), s])) });
  }

  const infos = groups.filter((g) => g.level === "info").length;
  let listedInfos = 0;
  const listed = groups.filter((g) => {
    if (g.level !== "info") return true;
    if (infos > INFO_MAX && listedInfos >= INFO_MAX) return false;
    listedInfos++;
    return true;
  });

  return {
    path: digest.path,
    facts,
    fields,
    nodes: nodes.map((name) => ({ name, frozen: frozenNodes.has(name) && states[name] !== undefined })),
    rows: rows.map((r) => {
      const cellNotes = r.cells.map((pieces, j) =>
        r.kind === "instance"
          ? sorted.filter((n) => !n.fromResource && n.nodes.includes(nodes[j] as string))
          : ordered(pieces.flatMap((p) => (isRef(p) ? p.notes : []))),
      );
      const rowNotes =
        r.kind === "instance" ? sorted.filter((n) => !n.fromResource) : ordered(cellNotes.flat());
      return {
        ...r,
        cells: r.cells.map(resolve),
        cellNotes: cellNotes.map((l) => l.map(toRowNote)),
        rowNotes: rowNotes.map(toRowNote),
      };
    }),
    notes: listed.map((g) => ({
      level: g.level,
      text: g.text,
      heads: g.notes.map((n, i) => ({
        // The first head of an entry has its marker, or a dot for a note no cell points to.
        marker: i === 0 ? (n.marker === "" ? "·" : n.marker) : "",
        subject: n.subject,
        nodes: nodesText(n.nodes),
      })),
    })),
    moreInfos: Math.max(0, infos - INFO_MAX),
  };
}

/** An object status, colored as om's colorstatus colors it. */
function statusSpan(st: string | undefined): Span {
  const status = { status: st ?? "" };
  switch (st) {
    case "up":
    case "stdby up":
      return span(st, "optimal", status);
    case "down":
    case "stdby down":
      return span(st, "error", status);
    case "warn":
      return span(st, "warning", status);
    default:
      return span(st ?? "", "secondary", status);
  }
}
