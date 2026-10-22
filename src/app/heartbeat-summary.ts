/*
 * What the heartbeat mesh says at a glance (HeartbeatSummary): how each heartbeat
 * fares over the cluster and the layer of infrastructure it goes over, how each node
 * fares, and each routine, the daemon thread of a stream of a node. Read from the
 * links of the mesh (meshLinks).
 */

import type { GroupState, MeshLink } from "./heartbeat-mesh";

/**
 * The kind of infrastructure a heartbeat goes over, its redundancy layer: the
 * network (unicast, multicast), the storage (a shared disk), a relay (a third
 * site). Two heartbeats of a layer fail together when it fails.
 */
export type Layer = "network" | "storage" | "relay" | "other";

export const LAYERS: readonly Layer[] = ["network", "storage", "relay", "other"];

export function layerOf(type: string): Layer {
  switch (type) {
    case "unicast":
    case "multicast":
      return "network";
    case "disk":
      return "storage";
    case "relay":
      return "relay";
    default:
      return "other";
  }
}

/** Links beating, on a stopped stream, out of all: the figures and the bar of a row. */
interface Counts {
  beating: number;
  stopped: number;
  total: number;
  state: GroupState;
}

/** A heartbeat over the cluster: its links beating out of all of them. */
export interface HeartbeatSummaryRow extends Counts {
  hb: string;
  type: string;
  layer: Layer;
}

function countsOf(links: MeshLink[]): Counts {
  const beating = links.filter((l) => l.state === "up").length;
  const stopped = links.filter((l) => l.streamState !== undefined && l.streamState !== "running").length;
  const total = links.length;
  return { beating, stopped, total, state: beating === total ? "up" : beating === 0 ? "down" : "warn" };
}

/** Each heartbeat, by its name, with its links beating out of all of them. */
export function heartbeatsOf(links: MeshLink[]): HeartbeatSummaryRow[] {
  const byHb = new Map<string, MeshLink[]>();
  for (const link of links) {
    byHb.set(link.hb, [...(byHb.get(link.hb) ?? []), link]);
  }
  return [...byHb.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hb, of]) => {
      const type = of.find((l) => l.type)?.type ?? "";
      return { hb, type, layer: layerOf(type), ...countsOf(of) };
    });
}

/** A node: all its streams, sending and receiving, over all its heartbeats. */
export interface NodeSummaryRow extends Counts {
  node: string;
  hbs: string[];
}

/** Each node reporting streams, by its name, with their links beating out of all. */
export function nodesOf(links: MeshLink[]): NodeSummaryRow[] {
  const byNode = new Map<string, MeshLink[]>();
  for (const link of links) {
    byNode.set(link.node, [...(byNode.get(link.node) ?? []), link]);
  }
  return [...byNode.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([node, of]) => ({ node, hbs: [...new Set(of.map((l) => l.hb))].sort(), ...countsOf(of) }));
}

/**
 * A routine: the daemon thread of a stream of a node, a heartbeat and a direction
 * ("hb#1.tx" of n1), its links toward its peers.
 */
export interface RoutineSummaryRow extends Counts {
  node: string;
  hb: string;
  dir: "tx" | "rx";
  /** The stream as the daemon reports it, "hb#1.tx". */
  id: string;
  type: string;
  streamState?: string;
}

/** Each routine, by node, heartbeat, then sending before receiving. */
export function routinesOf(links: MeshLink[]): RoutineSummaryRow[] {
  const byRoutine = new Map<string, MeshLink[]>();
  for (const link of links) {
    if (link.dir === "") continue;
    const key = `${link.node} ${link.hb}.${link.dir}`;
    byRoutine.set(key, [...(byRoutine.get(key) ?? []), link]);
  }
  return [...byRoutine.values()]
    .map((of) => ({
      node: of[0].node,
      hb: of[0].hb,
      dir: of[0].dir as "tx" | "rx",
      id: `${of[0].hb}.${of[0].dir}`,
      type: of[0].type,
      streamState: of[0].streamState,
      ...countsOf(of),
    }))
    .sort((a, b) =>
      a.node.localeCompare(b.node) || a.hb.localeCompare(b.hb) || (a.dir === b.dir ? 0 : a.dir === "tx" ? -1 : 1));
}
