/*
 * The sketch of a network (`sketch-layout.ts`): its range in a band over the nodes of
 * the cluster, a box for each node saying what the network is on it, the objects
 * holding addresses of it under the boxes. What each type puts on a node, from its
 * section of the cluster configuration:
 *
 * - routed_bridge: a subnet of the range a node, on a bridge, routed between the
 *   nodes, through tunnels from an endpoint of each node;
 * - bridge: the same range on every node, on a bridge, masqueraded out of the node;
 * - lan: a segment the nodes share, joined through an interface of each node;
 * - l2_bridge: a bridge with no address on each node, alone, or meshed with the others
 *   by the ports of a lan they share or by a vxlan.
 *
 * What the setup of the network made on a node, its report (`/api/network/node`), wins
 * over the configuration: the device, the subnet, the ports, and how the node reaches
 * each other node, by a tunnel it names, a route or a vxlan, which only the node knows,
 * a tunnel `auto` decided on its own addresses. The configuration says the rest, and
 * all of a node that reported nothing.
 *
 * An address is one whatever the nodes reporting it: an address of a lan an object's
 * instances share is drawn once, a pill across the nodes.
 */
import { type SketchFact, type SketchLayout, layoutSketch } from "./sketch-layout";

export {
  CHAR_WIDTH,
  CHIP_HEIGHT,
  LINE,
  MAX_OBJECTS,
  MAX_SHARED,
  MONO_WIDTH,
  PADDING,
  type SketchFact,
  type SketchLayout,
  type SketchNode,
  type SketchObject,
  type SketchSegment,
  type SketchShared,
} from "./sketch-layout";

/** The keys of the section, `key` or `key@node`, and their values. */
export type SectionValues = Record<string, string>;

export interface SketchAddress {
  ip?: string;
  node?: string;
  path?: string;
  rid?: string;
}

/** How a node reaches a peer, as its network setup reported it. */
export interface NetworkPeerReport {
  nodename: string;
  local?: string;
  remote?: string;
  subnet?: string;
  tunnel?: string;
  /** The mode of the tunnel, as ipip, ip6ip6 or gre. */
  tunnel_mode?: string;
  via?: "tunnel" | "route" | "vxlan";
  error?: string;
}

/** What the last setup of a network made on a node (`/api/network/node`). */
export interface NetworkReport {
  name: string;
  node: string;
  type?: string;
  dev?: string;
  subnet?: string;
  peers?: NetworkPeerReport[];
  ports?: { name: string; dev: string; error?: string }[];
  skipped?: string;
  error?: string;
  applied_at?: string;
}

/** How a node reaches a peer: as it said, else by its tunnel. */
export const peerVia = (p: NetworkPeerReport): "tunnel" | "route" | "vxlan" => p.via ?? (p.tunnel ? "tunnel" : "route");

export interface SketchInput {
  name: string;
  type: string;
  network: string;
  values: SectionValues;
  nodes: string[];
  addresses: SketchAddress[];
  /** What the setup of the network made on each node that reported it. */
  reports?: NetworkReport[];
  /** A finger as the pointer: the chips of the addresses taller, further apart. */
  touch?: boolean;
}

/** The value of a key on a node: scoped to it, or set for all. */
const scoped = (values: SectionValues, key: string, node: string): string | undefined =>
  values[`${key}@${node}`] ?? values[key];

/** What the network is over all the nodes, its band. */
export function bandFacts({ type, network, values }: Pick<SketchInput, "type" | "network" | "values">): SketchFact[] {
  const facts: SketchFact[] = [{ key: "network", value: network }];
  const add = (key: string) => {
    if (values[key]) facts.push({ key, value: values[key] });
  };
  if (type === "routed_bridge") ["tunnel", "tunnel_mode", "ips_per_node", "mask_per_node"].forEach(add);
  if (type === "lan") ["ranges", "gateway", "modes"].forEach(add);
  if (type === "bridge") add("public");
  add("dns");
  return facts;
}

/**
 * The facts a node reported of the network: the failure of its setup, or why it left
 * the network alone; its ports; each peer, by the tunnel it reaches it through, its
 * address routed or vxlan'd to, or why it could not.
 */
function reportFacts(report: NetworkReport): SketchFact[] {
  const facts: SketchFact[] = [];
  if (report.skipped) facts.push({ key: "skipped", value: report.skipped });
  if (report.error) facts.push({ key: "error", value: report.error });
  const ports = (report.ports ?? []).map((p) => (p.error ? `${p.dev}!` : p.dev));
  if (ports.length) facts.push({ key: "ports", value: ports.join(" ") });
  for (const p of report.peers ?? []) {
    if (p.error) facts.push({ key: `error@${p.nodename}`, value: p.error });
    else if (peerVia(p) === "tunnel") facts.push({ key: `tunnel@${p.nodename}`, value: [p.tunnel, p.tunnel_mode].filter(Boolean).join(" ") });
    else facts.push({ key: `${peerVia(p)}@${p.nodename}`, value: p.remote ?? "" });
  }
  return facts;
}

/** What the network is on a node, its box: as the node reported it, the configuration saying the rest. */
export function nodeFacts(
  { name, type, values, reports }: Pick<SketchInput, "name" | "type" | "values" | "reports">,
  node: string,
): SketchFact[] {
  const facts: SketchFact[] = [];
  const set = (key: string, value: string | undefined) => {
    if (value) facts.push({ key, value });
  };
  const report = reports?.find((r) => r.node === node);
  if (report) {
    set("dev", report.dev);
    set("subnet", report.subnet);
    if (type === "routed_bridge") {
      set("addr", scoped(values, "addr", node));
      set("gateway", values[`gateway@${node}`]);
    } else if (type === "lan") {
      set("gateway", values[`gateway@${node}`]);
      set("vlan_tag", scoped(values, "vlan_tag", node));
    }
    return [...facts, ...reportFacts(report)];
  }
  // The bridge of a node, `obr_<network>` unless named.
  const bridge = values.dev || `obr_${name}`;
  if (type === "routed_bridge") {
    const subnet = scoped(values, "subnet", node);
    facts.push(subnet ? { key: "subnet", value: subnet } : { key: "subnet", value: "", computed: true });
    set("dev", bridge);
    set("addr", scoped(values, "addr", node));
    set("gateway", values[`gateway@${node}`]);
  } else if (type === "bridge") {
    set("network", values[`network@${node}`]);
    set("dev", bridge);
  } else if (type === "lan") {
    set("dev", scoped(values, "dev", node));
    set("gateway", values[`gateway@${node}`]);
    set("vlan_tag", scoped(values, "vlan_tag", node));
  } else if (type === "l2_bridge") {
    set("dev", bridge);
  }
  // A node reporting nothing of a network others report: not set up on it, yet.
  if (reports?.length) facts.push({ key: "setup", value: "none" });
  return facts;
}

/**
 * The routes between the nodes, as the nodes reported them: a pipe when one reaches
 * another through a tunnel or a vxlan, a line when routed alone, none without a peer.
 * Of no report, a routed bridge is routed, through tunnels unless `tunnel` is never.
 */
export function routeOf({ type, values, reports }: Pick<SketchInput, "type" | "values" | "reports">): { tunnel: boolean } | null {
  if (!reports?.length) return type === "routed_bridge" ? { tunnel: values.tunnel !== "never" } : null;
  const vias = new Set(reports.flatMap((r) => (r.peers ?? []).filter((p) => !p.error).map(peerVia)));
  if (vias.size === 0) return null;
  return { tunnel: vias.has("tunnel") || vias.has("vxlan") };
}

/** The modes of the tunnels the nodes reported, sorted. */
export function tunnelModes(reports: NetworkReport[] | undefined): string[] {
  const modes = (reports ?? []).flatMap((r) => (r.peers ?? []).filter((p) => !p.error && p.tunnel_mode).map((p) => p.tunnel_mode as string));
  return [...new Set(modes)].sort();
}

/** The ways the nodes reach each other, as they reported them, sorted. */
export function routeVias(reports: NetworkReport[] | undefined): string[] {
  return [...new Set((reports ?? []).flatMap((r) => (r.peers ?? []).filter((p) => !p.error).map(peerVia)))].sort();
}

/**
 * The layout of the sketch of a network: an address by its object, resource and ip;
 * the routes between the nodes as they reported them (`routeOf`).
 * `computedText`, the width of the words saying a value is the daemon's, `routeText`,
 * of the label of the routes, both translated by the page.
 */
export function sketchLayout(input: SketchInput, computedText = 120, routeText = 90): SketchLayout {
  return layoutSketch(
    {
      title: `${input.name} · ${input.type}`,
      bandFacts: bandFacts(input),
      nodes: input.nodes,
      nodeFacts: Object.fromEntries(input.nodes.map((node) => [node, nodeFacts(input, node)])),
      items: input.addresses
        .filter((a) => a.node)
        .map((a) => ({ key: `${a.path ?? ""} ${a.rid ?? ""} ${a.ip ?? ""}`, path: a.path ?? "", node: a.node })),
      route: routeOf(input),
      touch: input.touch,
    },
    computedText,
    routeText,
  );
}
