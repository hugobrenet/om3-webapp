import { describe, expect, test } from "vitest";
import { MAX_OBJECTS, MAX_SHARED, bandFacts, nodeFacts, routeOf, routeVias, sketchLayout, tunnelModes } from "../network-sketch";

const ROUTED = {
  name: "backend3",
  type: "routed_bridge",
  network: "10.100.0.0/22",
  values: {
    type: "routed_bridge",
    network: "10.100.0.0/22",
    ips_per_node: "256",
    tunnel: "always",
    "subnet@n1": "10.100.0.0/24",
    "subnet@n2": "10.100.1.0/24",
    "addr@n1": "fd00::11",
  },
  nodes: ["n1", "n2", "n3"],
  addresses: [
    { ip: "10.100.0.2", node: "n1", path: "ns/svc/a", rid: "ip#1" },
    { ip: "10.100.0.3", node: "n1", path: "ns/svc/a", rid: "ip#2" },
    { ip: "10.100.0.4", node: "n1", path: "ns/svc/b", rid: "ip#1" },
    { ip: "10.100.1.2", node: "n2", path: "ns/svc/c", rid: "ip#1" },
    // A node not of the cluster any more: left out.
    { ip: "10.100.2.2", node: "gone", path: "ns/svc/d", rid: "ip#1" },
  ],
};

describe("network sketch", () => {
  test("the band: the range, and what the type sets over all the nodes", () => {
    expect(bandFacts(ROUTED)).toEqual([
      { key: "network", value: "10.100.0.0/22" },
      { key: "tunnel", value: "always" },
      { key: "ips_per_node", value: "256" },
    ]);
    expect(bandFacts({ type: "lan", network: "192.168.10.0/24", values: { ranges: "192.168.10.128/26", modes: "macvlan" } }))
      .toEqual([
        { key: "network", value: "192.168.10.0/24" },
        { key: "ranges", value: "192.168.10.128/26" },
        { key: "modes", value: "macvlan" },
      ]);
  });

  test("a node of a routed bridge: its subnet, the daemon's when none set; its bridge; its tunnel endpoint", () => {
    expect(nodeFacts(ROUTED, "n1")).toEqual([
      { key: "subnet", value: "10.100.0.0/24" },
      { key: "dev", value: "obr_backend3" },
      { key: "addr", value: "fd00::11" },
    ]);
    expect(nodeFacts(ROUTED, "n3")).toEqual([
      { key: "subnet", value: "", computed: true },
      { key: "dev", value: "obr_backend3" },
    ]);
  });

  test("a node of a lan: its interface, scoped or for all; of a bridge, its bridge", () => {
    const lan = { name: "san", type: "lan", values: { dev: "eth1", "dev@n2": "bond0", "gateway@n2": "192.168.10.254" } };
    expect(nodeFacts(lan, "n1")).toEqual([{ key: "dev", value: "eth1" }]);
    expect(nodeFacts(lan, "n2")).toEqual([{ key: "dev", value: "bond0" }, { key: "gateway", value: "192.168.10.254" }]);
    expect(nodeFacts({ name: "default", type: "bridge", values: {} }, "n1")).toEqual([{ key: "dev", value: "obr_default" }]);
  });

  test("the layout: a box a node under the band, one height, side by side; routes between them; the objects under each", () => {
    const layout = sketchLayout(ROUTED);
    expect(layout.nodes.map((n) => n.name)).toEqual(["n1", "n2", "n3"]);
    expect(new Set(layout.nodes.map((n) => n.height)).size).toBe(1);
    expect(new Set(layout.nodes.map((n) => n.y)).size).toBe(1);
    expect(layout.nodes[0].y).toBeGreaterThan(layout.band.y + layout.band.height);
    for (let i = 1; i < layout.nodes.length; i += 1) {
      expect(layout.nodes[i].x).toBeGreaterThan(layout.nodes[i - 1].x + layout.nodes[i - 1].width);
    }
    // Each drop from the band to the middle of its box.
    for (const n of layout.nodes) {
      expect(n.drop).toEqual({ x: n.x + n.width / 2, y1: layout.band.y + layout.band.height, y2: n.y });
    }
    // One route across the row, under the boxes, past the first and the last, its label after it; through tunnels.
    const [first, , third] = layout.nodes;
    expect(layout.route).toEqual({
      x1: first.x - 20,
      x2: third.x + third.width + 20,
      y: first.y + first.height / 2,
      tunnel: true,
      labelX: third.x + third.width + 26,
    });
    expect(layout.width).toBeGreaterThanOrEqual(layout.route!.labelX + 90);
    expect(layout.route!.x1).toBeGreaterThan(0);
    expect(layout.nodes.map((n) => n.count)).toEqual([3, 1, 0]);
    expect(layout.objects.map((o) => [o.node, o.path, o.count])).toEqual([
      ["n1", "ns/svc/a", 2],
      ["n1", "ns/svc/b", 1],
      ["n2", "ns/svc/c", 1],
    ]);
    const last = layout.nodes[2];
    expect(layout.width).toBeGreaterThanOrEqual(last.x + last.width);
    expect(layout.height).toBeGreaterThan(Math.max(...layout.objects.map((o) => o.y)));
  });

  test("no routes but for a routed bridge; an address told on a node once; the objects past the most shown counted", () => {
    const addresses = Array.from({ length: MAX_OBJECTS + 2 }, (_, i) => ({ ip: `10.0.0.${i}`, node: "n1", path: `ns/svc/o${i}`, rid: "ip#1" }));
    // The same address reported twice on its node.
    addresses.push({ ...addresses[0] });
    const layout = sketchLayout({ name: "seg", type: "lan", network: "10.0.0.0/24", values: {}, nodes: ["n1", "n2"], addresses });
    expect(layout.route).toBeNull();
    expect(layout.nodes[0].count).toBe(MAX_OBJECTS + 2);
    expect(layout.objects).toHaveLength(MAX_OBJECTS);
    expect(layout.more).toEqual([expect.objectContaining({ node: "n1", count: 2 })]);
  });

  test("an address reported by several nodes drawn once, a pill across all the columns: a lan address an object's instances share", () => {
    const nodes = ["n1", "n2", "n3"];
    // 31 addresses, of as many objects, each reported by every node; one more, held on n2 alone.
    const addresses = nodes.flatMap((node) =>
      Array.from({ length: 31 }, (_, i) => ({ ip: `fd01::5:${i}`, node, path: `svc${i}`, rid: "ip#1" })),
    );
    addresses.push({ ip: "fd01::9", node: "n2", path: "solo", rid: "ip#1" });
    const layout = sketchLayout({ name: "san", type: "lan", network: "fd01::/64", values: {}, nodes, addresses });
    const shared = layout.shared!;
    expect(shared.count).toBe(31);
    expect(shared.rows).toHaveLength(MAX_SHARED);
    expect(shared.rows[0]).toMatchObject({ path: "svc0", count: 1, nodes: ["n1", "n2", "n3"] });
    expect(shared.more?.count).toBe(31 - MAX_SHARED);
    // Across the columns, from the left of the first box to the right of the last, under the boxes.
    const [first, , last] = layout.nodes;
    for (const row of shared.rows) {
      expect(row.x).toBe(first.x);
      expect(row.x + row.width).toBe(last.x + last.width);
      expect(row.y).toBeGreaterThan(first.y + first.height);
      expect(row.segments.every((seg) => seg.present)).toBe(true);
    }
    // The band its facts alone; the one held on one node under its box, after the pills.
    expect(layout.band).not.toHaveProperty("shared");
    expect(layout.objects.map((o) => [o.node, o.path])).toEqual([["n2", "solo"]]);
    expect(layout.objects[0].y).toBeGreaterThan(shared.rows[shared.rows.length - 1].y);
    expect(layout.nodes.map((n) => [n.count, n.shared])).toEqual([[0, 31], [1, 31], [0, 31]]);
  });

  test("the pills and the chips under the boxes one pitch apart, the first chip after the last pill as two chips are", () => {
    const addresses = [
      ...["n1", "n2"].map((node) => ({ ip: "10.0.0.5", node, path: "web", rid: "ip#1" })),
      { ip: "10.0.0.6", node: "n1", path: "a", rid: "ip#1" },
      { ip: "10.0.0.7", node: "n1", path: "b", rid: "ip#1" },
    ];
    const layout = sketchLayout({ name: "seg", type: "lan", network: "10.0.0.0/24", values: {}, nodes: ["n1", "n2"], addresses });
    const [pill] = layout.shared!.rows;
    const [a, b] = layout.objects;
    const box = layout.nodes[0];
    // From the box to the first row, as before; then every row the same pitch.
    expect(pill.y - (box.y + box.height)).toBe(12);
    expect(a.y - pill.y).toBe(b.y - a.y);
  });

  test("a pill dashed over the nodes not reporting its addresses, its stretches meeting halfway into the gaps", () => {
    const addresses = ["n1", "n3"].map((node) => ({ ip: "10.0.0.5", node, path: "web", rid: "ip#1" }));
    const layout = sketchLayout({ name: "seg", type: "lan", network: "10.0.0.0/24", values: {}, nodes: ["n1", "n2", "n3"], addresses });
    const [row] = layout.shared!.rows;
    expect(row.segments.map((seg) => [seg.node, seg.present])).toEqual([["n1", true], ["n2", false], ["n3", true]]);
    const [a, b, c] = layout.nodes;
    expect(row.segments[0]).toMatchObject({ x1: a.x, x2: (a.x + a.width + b.x) / 2 });
    expect(row.segments[1]).toMatchObject({ x1: (a.x + a.width + b.x) / 2, x2: (b.x + b.width + c.x) / 2 });
    expect(row.segments[2]).toMatchObject({ x2: c.x + c.width });
    expect(layout.nodes.map((n) => n.shared)).toEqual([1, 0, 1]);
  });

  test("no shared address: no pill", () => {
    expect(sketchLayout(ROUTED).shared).toBeNull();
    expect(sketchLayout(ROUTED).nodes.every((n) => n.shared === 0)).toBe(true);
  });

  test("no tunnel, routes alone; one node, nothing to route", () => {
    expect(sketchLayout({ ...ROUTED, values: { ...ROUTED.values, tunnel: "never" } }).route?.tunnel).toBe(false);
    expect(sketchLayout({ ...ROUTED, nodes: ["n1"] }).route).toBeNull();
  });

  test("no node: the band alone", () => {
    const layout = sketchLayout({ ...ROUTED, nodes: [], addresses: [] });
    expect(layout.nodes).toEqual([]);
    expect(layout.height).toBeGreaterThan(layout.band.y + layout.band.height);
  });

  // backend3 routed between n1 and n2, tunnelled to n3 from n1 alone: a tunnel auto
  // decides on the addresses of each node, so the two ends may differ.
  const REPORTS = [
    {
      name: "backend3",
      node: "n1",
      dev: "obr_backend3",
      subnet: "10.100.0.0/24",
      peers: [
        { nodename: "n2", local: "10.29.0.11", remote: "10.29.0.12", subnet: "10.100.1.0/24", tunnel: "", via: "route" as const },
        { nodename: "n3", local: "10.29.0.11", remote: "10.30.0.13", subnet: "10.100.2.0/24", tunnel: "tun1030013", tunnel_mode: "ipip", via: "tunnel" as const },
      ],
    },
    {
      name: "backend3",
      node: "n2",
      dev: "obr_backend3",
      subnet: "10.100.1.0/24",
      peers: [
        { nodename: "n1", local: "10.29.0.12", remote: "10.29.0.11", subnet: "10.100.0.0/24", tunnel: "", via: "route" as const },
        { nodename: "n3", remote: "10.30.0.13", subnet: "10.100.2.0/24", tunnel: "", error: "no route to host" },
      ],
    },
  ];

  test("a node that reported its setup: its device and subnet, then each peer by the tunnel it names, the address it routes to, or its failure", () => {
    const input = { ...ROUTED, reports: REPORTS };
    expect(nodeFacts(input, "n1")).toEqual([
      { key: "dev", value: "obr_backend3" },
      { key: "subnet", value: "10.100.0.0/24" },
      { key: "addr", value: "fd00::11" },
      { key: "route@n2", value: "10.29.0.12" },
      { key: "tunnel@n3", value: "tun1030013 ipip" },
    ]);
    expect(nodeFacts(input, "n2")).toEqual([
      { key: "dev", value: "obr_backend3" },
      { key: "subnet", value: "10.100.1.0/24" },
      { key: "route@n1", value: "10.29.0.11" },
      { key: "error@n3", value: "no route to host" },
    ]);
    // A node reporting nothing of a network others report: the configuration, and not set up.
    expect(nodeFacts(input, "n3")).toEqual([
      { key: "subnet", value: "", computed: true },
      { key: "dev", value: "obr_backend3" },
      { key: "setup", value: "none" },
    ]);
  });

  test("the routes as the nodes reported them: a pipe for a tunnel, a line for routes alone, none for no peer", () => {
    expect(routeOf({ ...ROUTED, reports: REPORTS })).toEqual({ tunnel: true });
    expect(routeVias(REPORTS)).toEqual(["route", "tunnel"]);
    expect(tunnelModes(REPORTS)).toEqual(["ipip"]);
    // tunnel = always configured, but every node routes: no tunnel drawn.
    const routed = REPORTS.map((r) => ({ ...r, peers: r.peers.filter((p) => p.via === "route") }));
    expect(routeOf({ ...ROUTED, reports: routed })).toEqual({ tunnel: false });
    expect(sketchLayout({ ...ROUTED, reports: routed }).route?.tunnel).toBe(false);
    // Of no report, the configuration.
    expect(routeOf(ROUTED)).toEqual({ tunnel: true });
    // A l2_bridge alone on each node has no peer: no route.
    const alone = [{ name: "l2", node: "n1", dev: "obr_l2" }, { name: "l2", node: "n2", dev: "obr_l2" }];
    expect(routeOf({ type: "l2_bridge", values: {}, reports: alone })).toBeNull();
  });

  test("a l2_bridge meshed by a vxlan: a pipe, each peer at its address; meshed by ports, the ports, a failed one marked", () => {
    const vx = [
      { name: "l2vx", node: "n1", dev: "obr_l2vx", peers: [{ nodename: "n2", local: "10.29.0.11", remote: "10.29.0.12", tunnel: "vx_l2vx", via: "vxlan" as const }] },
    ];
    expect(routeOf({ type: "l2_bridge", values: {}, reports: vx })).toEqual({ tunnel: true });
    expect(routeVias(vx)).toEqual(["vxlan"]);
    expect(nodeFacts({ name: "l2vx", type: "l2_bridge", values: {}, reports: vx }, "n1")).toEqual([
      { key: "dev", value: "obr_l2vx" },
      { key: "vxlan@n2", value: "10.29.0.12" },
    ]);
    const lan = [
      { name: "l2lan", node: "n1", dev: "obr_l2lan", ports: [{ name: "eno2", dev: "eno2.300" }, { name: "eno3", dev: "eno3.300", error: "port eno3: not found" }], error: "ports: port eno3: not found" },
    ];
    expect(nodeFacts({ name: "l2lan", type: "l2_bridge", values: {}, reports: lan }, "n1")).toEqual([
      { key: "dev", value: "obr_l2lan" },
      { key: "error", value: "ports: port eno3: not found" },
      { key: "ports", value: "eno2.300 eno3.300!" },
    ]);
  });
});
