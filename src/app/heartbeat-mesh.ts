/*
 * The heartbeat mesh of a cluster: its nodes, and a link for each stream of each
 * node toward each of its peers, as the daemons report them (DaemonHeartbeatUpdated).
 *
 * A tx stream of a node sends to its peer, an rx stream receives from it: the link
 * runs from the sender to the receiver. Each end reports its own stream, so the
 * hb#1 of two nodes is four links, two each way: n1 tx and n2 rx, n2 tx and n1 rx.
 */

export interface HeartbeatPeer {
  desc?: string;
  is_beating?: boolean;
  changed_at?: string;
  last_beating_at?: string;
}

export interface HeartbeatStream {
  id: string;
  type?: string;
  state?: string;
  peers?: Record<string, HeartbeatPeer>;
}

export interface MeshLink {
  /** Unique in the mesh: the stream of a node toward a peer. */
  key: string;
  /** The node reporting the stream, and the peer it is toward. */
  node: string;
  peer: string;
  /** The heartbeat, "hb#1", and the side of the stream on its node. */
  hb: string;
  dir: "rx" | "tx" | "";
  type: string;
  /** The sender and the receiver. */
  from: string;
  to: string;
  /** Up when the stream runs and the peer beats, down otherwise. */
  state: "up" | "down";
  streamState?: string;
  desc?: string;
  lastBeatingAt?: string;
}

/** The heartbeat of a stream and its side: "hb#1.tx" is hb#1, tx. */
function streamSide(id: string): { hb: string; dir: MeshLink["dir"] } {
  const match = /^(.*)\.(rx|tx)$/.exec(id ?? "");
  return match ? { hb: match[1], dir: match[2] as MeshLink["dir"] } : { hb: id, dir: "" };
}

/**
 * The peers of a stream reporting none, as a stopped one does: those of the other
 * streams of its heartbeat on its node, its other side, or else every other node.
 * It is down toward each, and it is the stream a line turning orange or red calls
 * for, so its card lists it.
 */
function impliedPeers(
  heartbeatStatus: Record<string, { streams?: HeartbeatStream[] } | undefined>,
  node: string,
  hb: string,
): string[] {
  const known = new Set<string>();
  for (const other of heartbeatStatus[node]?.streams ?? []) {
    if (streamSide(other.id).hb !== hb) continue;
    for (const peer of Object.keys(other.peers ?? {})) if (peer) known.add(peer);
  }
  if (known.size > 0) return [...known].sort();
  return Object.keys(heartbeatStatus).filter((n) => n !== node).sort();
}

/** The links of the mesh, in the order of the nodes, then of their streams. */
export function meshLinks(heartbeatStatus: Record<string, { streams?: HeartbeatStream[] } | undefined>): MeshLink[] {
  const links: MeshLink[] = [];
  for (const node of Object.keys(heartbeatStatus ?? {}).sort()) {
    for (const stream of heartbeatStatus[node]?.streams ?? []) {
      const { hb, dir } = streamSide(stream.id);
      const peers: [string, HeartbeatPeer | undefined][] = Object.keys(stream.peers ?? {}).length > 0
        ? Object.entries(stream.peers ?? {})
        : impliedPeers(heartbeatStatus, node, hb).map((peer) => [peer, undefined]);
      for (const [peer, status] of peers) {
        if (!peer) continue;
        const sends = dir !== "rx";
        links.push({
          key: `${node} ${stream.id} ${peer}`,
          node,
          peer,
          hb,
          dir,
          type: stream.type ?? "",
          from: sends ? node : peer,
          to: sends ? peer : node,
          state: stream.state === "running" && status?.is_beating === true ? "up" : "down",
          streamState: stream.state,
          desc: status?.desc,
          lastBeatingAt: status?.last_beating_at,
        });
      }
    }
  }
  return links;
}

/** The nodes of the mesh: those reporting heartbeats and their peers, sorted. */
export function meshNodes(heartbeatStatus: Record<string, unknown>, links: MeshLink[]): string[] {
  return [...new Set([...Object.keys(heartbeatStatus ?? {}), ...links.map((l) => l.peer)])].sort();
}

/** A group of links all beating, some, or none. */
export type GroupState = "up" | "warn" | "down";

/** The state of a group of links: up when all beat, down when none does, warn for a mix. */
export function groupState(links: MeshLink[]): GroupState {
  const up = links.filter((l) => l.state === "up").length;
  return up === links.length ? "up" : up === 0 ? "down" : "warn";
}

export interface Point {
  x: number;
  y: number;
}

/**
 * A half of the line of a direction: the side of one end, its links only. Tinted
 * by them, "none" when that end reports none.
 */
export interface MeshHalf {
  path: string;
  links: MeshLink[];
  state: GroupState | "none";
}

/**
 * A direction between two nodes: the links from one to the other, drawn as one
 * straight line cut in two halves, a gap between them: from the sender, its tx
 * streams, their arrow toward the receiver; into the receiver, its rx streams. Its
 * card lists each link.
 */
export interface MeshGroup {
  key: string;
  from: string;
  to: string;
  links: MeshLink[];
  state: GroupState;
  /** The line, from the edge of the sender to the edge of the receiver, gap included. */
  path: string;
  /** The half of the sender, its tx; the half of the receiver, its rx. */
  tx: MeshHalf;
  rx: MeshHalf;
  /** The middle of the line, where its card shows. */
  label: Point;
}

/** A node of the mesh: where it stands, its box, and the name it shows. */
export interface MeshNode extends Point {
  width: number;
  height: number;
  /** The name, cut short past MAX_LABEL characters, the whole of it in a tooltip. */
  label: string;
}

export interface MeshLayout {
  width: number;
  height: number;
  nodes: Record<string, MeshNode>;
  groups: MeshGroup[];
}

/** The height of a node box, a pill holding its name on one line. */
export const NODE_HEIGHT = 32;
/** The width of a character of a name, an estimate the layout can make without a browser. */
const CHAR_WIDTH = 7.5;
/** The room on each side of the name in its box. */
const NODE_PADDING = 14;
/** The narrowest box, a short name still a pill. */
const MIN_NODE_WIDTH = 64;
/** The longest name shown whole; a longer one is cut, its end an ellipsis. */
export const MAX_LABEL = 28;
/** The room between the two parallel lines of a pair of nodes, one each way. */
export const DIRECTION_OFFSET = 12;
/**
 * The gap between the two halves of a line, on a ring of more than three nodes: a
 * part of the line. The lines across the ring meet at its centre; their tx arrows
 * end that far before it, spread on a circle around it rather than piled on it.
 */
export const RING_GAP_RATIO = 0.3;
/** The gap between the two halves of a line of two or three nodes, which do not cross. */
export const SMALL_GAP = 24;

const round = (n: number) => Math.round(n * 10) / 10;

/** The name a node box shows: whole, or cut to MAX_LABEL characters, the last an ellipsis. */
export function nodeLabel(name: string): string {
  return name.length > MAX_LABEL ? `${name.slice(0, MAX_LABEL - 1)}…` : name;
}

/** The width of the box of a node, its name and its padding. */
export function nodeWidth(name: string): number {
  return Math.max(MIN_NODE_WIDTH, Math.round(nodeLabel(name).length * CHAR_WIDTH + 2 * NODE_PADDING));
}

/**
 * Where a ray leaves a box: from a point inside the box of a node, along a unit
 * direction, the distance to the first side it crosses.
 */
function exitDistance(box: MeshNode, from: Point, along: Point): number {
  const hw = box.width / 2;
  const hh = box.height / 2;
  const candidates: number[] = [];
  if (along.x !== 0) candidates.push((Math.sign(along.x) * hw - (from.x - box.x)) / along.x);
  if (along.y !== 0) candidates.push((Math.sign(along.y) * hh - (from.y - box.y)) / along.y);
  const positive = candidates.filter((d) => d >= 0);
  return positive.length > 0 ? Math.min(...positive) : 0;
}

/**
 * Where the nodes and the lines go, in a square. The nodes stand on a circle wide
 * enough for their boxes, two of them one over the other. Between two nodes, a line each way, straight
 * and parallel, one on each side of the line between their centres, so the two
 * directions never overlap; each line holds all the links of its direction, and
 * runs from the edge of the box of the sender to the edge of the box of the receiver.
 */
export function meshLayout(nodes: string[], links: MeshLink[]): MeshLayout {
  let width: number;
  let height: number;
  const boxes: Record<string, MeshNode> = {};
  const widths: Record<string, number> = Object.fromEntries(nodes.map((name) => [name, nodeWidth(name)]));
  const widest = Math.max(MIN_NODE_WIDTH, ...Object.values(widths));
  const place = (name: string, x: number, y: number) => {
    boxes[name] = { x, y, width: widths[name], height: NODE_HEIGHT, label: nodeLabel(name) };
  };
  // A square, whatever the nodes: the mesh as high as wide beside the summary, which
  // takes the rest of the width.
  if (nodes.length <= 1) {
    width = Math.max(240, widest + 80);
    height = width;
    if (nodes.length === 1) place(nodes[0], width / 2, height / 2);
  } else {
    // The circle long enough for the boxes side by side, and room for the lines; two
    // nodes on it face each other, one over the other.
    const radius = Math.max(200, nodes.length * 50, (nodes.length * (widest + 60)) / (2 * Math.PI));
    width = 2 * (radius + Math.max(widest / 2 + 40, NODE_HEIGHT / 2 + 60));
    height = width;
    nodes.forEach((name, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / nodes.length;
      place(name, width / 2 + radius * Math.cos(angle), height / 2 + radius * Math.sin(angle));
    });
  }

  const byDirection = new Map<string, MeshLink[]>();
  for (const link of links) {
    const key = `${link.from} ${link.to}`;
    byDirection.set(key, [...(byDirection.get(key) ?? []), link]);
  }

  const groups: MeshGroup[] = [];
  for (const [key, members] of [...byDirection].sort(([k], [l]) => k.localeCompare(l))) {
    const [from, to] = key.split(" ");
    const pf = boxes[from];
    const pt = boxes[to];
    if (!pf || !pt) continue;
    // The normal of the pair from its first node in name order: the direction
    // from that node runs on one side, the other way on the other.
    const [a, b] = [from, to].sort();
    const pa = boxes[a];
    const pb = boxes[b];
    const length = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
    const normal = { x: -(pb.y - pa.y) / length, y: (pb.x - pa.x) / length };
    // Half the room between the two lines on each side of the line of the centres.
    const offset = from === a ? -DIRECTION_OFFSET / 2 : DIRECTION_OFFSET / 2;
    // Straight, parallel to the line of the centres, that far from it: from where it
    // leaves the box of the sender to where it enters the box of the receiver.
    const along = { x: (pt.x - pf.x) / length, y: (pt.y - pf.y) / length };
    const back = { x: -along.x, y: -along.y };
    const startFrom = { x: pf.x + normal.x * offset, y: pf.y + normal.y * offset };
    const endFrom = { x: pt.x + normal.x * offset, y: pt.y + normal.y * offset };
    const out = exitDistance(pf, startFrom, along);
    const into = exitDistance(pt, endFrom, back);
    const start = { x: startFrom.x + along.x * out, y: startFrom.y + along.y * out };
    const end = { x: endFrom.x + back.x * into, y: endFrom.y + back.y * into };
    const label = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    // The two halves, the gap between them centred on the middle of the line.
    const visible = Math.hypot(end.x - start.x, end.y - start.y);
    const gap = Math.min(visible / 2, nodes.length > 3 ? visible * RING_GAP_RATIO : SMALL_GAP);
    const at = (d: number) => ({ x: start.x + along.x * d, y: start.y + along.y * d });
    const segment = (a: Point, b: Point) => `M ${round(a.x)} ${round(a.y)} L ${round(b.x)} ${round(b.y)}`;
    // By heartbeat, the sender's tx before the receiver's rx.
    const sorted = [...members].sort((l, m) => l.hb.localeCompare(m.hb) || (l.dir === "tx" ? -1 : 0) - (m.dir === "tx" ? -1 : 0));
    const half = (of: MeshLink[], path: string): MeshHalf => ({ path, links: of, state: of.length > 0 ? groupState(of) : "none" });
    groups.push({
      key,
      from,
      to,
      links: sorted,
      state: groupState(members),
      path: segment(start, end),
      // A stream of no side sends, as meshLinks reads it.
      tx: half(sorted.filter((l) => l.dir !== "rx"), segment(start, at((visible - gap) / 2))),
      rx: half(sorted.filter((l) => l.dir === "rx"), segment(at((visible + gap) / 2), end)),
      label: { x: round(label.x), y: round(label.y) },
    });
  }
  return { width, height, nodes: boxes, groups };
}
