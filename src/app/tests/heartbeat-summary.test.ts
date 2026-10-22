import { describe, expect, test } from "vitest";
import type { MeshLink } from "../heartbeat-mesh";
import { heartbeatsOf, layerOf, nodesOf, routinesOf } from "../heartbeat-summary";

/** A link one way, its sender and receiver, beating or not. */
const link = (hb: string, type: string, from: string, to: string, up: boolean, extra: Partial<MeshLink> = {}): MeshLink => ({
  key: `${hb} ${from} ${to}`,
  node: from,
  peer: to,
  hb,
  dir: "tx",
  type,
  from,
  to,
  state: up ? "up" : "down",
  streamState: "running",
  ...extra,
});

/** Both ways between two nodes, beating or not each. */
const both = (hb: string, type: string, a: string, b: string, aToB: boolean, bToA = aToB) => [
  link(hb, type, a, b, aToB),
  link(hb, type, b, a, bToA),
];

describe("heartbeat summary", () => {
  test("the layer of a driver: the network for unicast and multicast, the storage for a disk, a relay", () => {
    expect(["unicast", "multicast", "disk", "relay", "foo"].map(layerOf)).toEqual(["network", "network", "storage", "relay", "other"]);
  });

  test("each heartbeat over the cluster: its links beating out of all, its driver and layer", () => {
    const rows = heartbeatsOf([...both("hb#2", "disk", "n1", "n2", true, false), ...both("hb#1", "unicast", "n1", "n2", true)]);
    expect(rows.map((r) => [r.hb, r.type, r.layer, r.beating, r.total, r.state])).toEqual([
      ["hb#1", "unicast", "network", 2, 2, "up"],
      ["hb#2", "disk", "storage", 1, 2, "warn"],
    ]);
  });

  // The links of both sides of each end: a tx and the rx of its peer.
  const ends = (hb: string, a: string, b: string, up: boolean, extra: Partial<MeshLink> = {}) => [
    link(hb, "unicast", a, b, up, { node: a, peer: b, dir: "tx", ...extra }),
    link(hb, "unicast", a, b, up, { node: b, peer: a, dir: "rx" }),
  ];
  const LINKS = () => [
    ...ends("hb#1", "n10", "n1", true),
    ...ends("hb#1", "n1", "n10", true),
    ...ends("hb#2", "n1", "n10", false, { streamState: "stopped" }),
  ];

  test("each node: all its streams, its heartbeats, their links beating, stopped, out of all", () => {
    expect(nodesOf(LINKS()).map((r) => [r.node, r.hbs, r.beating, r.stopped, r.total, r.state])).toEqual([
      ["n1", ["hb#1", "hb#2"], 2, 1, 3, "warn"],
      ["n10", ["hb#1", "hb#2"], 2, 0, 3, "warn"],
    ]);
  });

  test("each routine, a stream of a node: its links beating out of all, its state, by node, heartbeat, tx first", () => {
    expect(routinesOf(LINKS()).map((r) => [r.node, r.id, r.dir, r.type, r.streamState, r.beating, r.total, r.state])).toEqual([
      ["n1", "hb#1.tx", "tx", "unicast", "running", 1, 1, "up"],
      ["n1", "hb#1.rx", "rx", "unicast", "running", 1, 1, "up"],
      ["n1", "hb#2.tx", "tx", "unicast", "stopped", 0, 1, "down"],
      ["n10", "hb#1.tx", "tx", "unicast", "running", 1, 1, "up"],
      ["n10", "hb#1.rx", "rx", "unicast", "running", 1, 1, "up"],
      ["n10", "hb#2.rx", "rx", "unicast", "running", 0, 1, "down"],
    ]);
  });

});
