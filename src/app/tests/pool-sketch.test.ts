import { describe, expect, test } from "vitest";
import { poolBandFacts, poolNodeFacts, poolSketchInput, poolSketchLayout, volumeNodes } from "../pool-sketch";
import { POOL_RULES } from "../pool-config";
import { type Keyword, sectionFields, sectionTypes } from "../section-config";
// The pool keywords as the daemon declares them (GET /api/cluster/config/keywords).
import KEYWORDS from "./pool-keywords.fixture.json";

const MiB = (n: number) => `${n} MiB`;
const format = (bytes: number) => MiB(Math.round(bytes / 1024 / 1024));

const POOL = { name: "drbdz", type: "drbd", head: "tank", size: 12 * 2 ** 30, used: 2 ** 30, free: 11 * 2 ** 30, capabilities: ["blk", "file", "shared"] };
const PER_NODE = {
  n1: { ...POOL, node: "n1", size: 4 * 2 ** 30, used: 300 * 2 ** 20 },
  n2: { ...POOL, node: "n2", head: "tank2", size: 4 * 2 ** 30, used: 100 * 2 ** 20 },
};
const VOLUMES = [
  // Used on two nodes: a pill.
  { path: "ns/vol/data", size: 512 * 2 ** 20, children: ["ns/svc/db@n1", "ns/svc/db@n2"] },
  // Used on one: a chip under its node.
  { path: "ns/vol/logs", size: 64 * 2 ** 20, children: ["ns/svc/web@n2"] },
  // Used by none: a pill dashed all along.
  { path: "ns/vol/old", size: 16 * 2 ** 20, children: [] },
];

describe("pool sketch", () => {
  test("the band: its head, where it takes its volumes from, its capabilities", () => {
    expect(poolBandFacts({ pool: POOL, values: { type: "drbd", vg: "data", fs_type: "xfs" } })).toEqual([
      { key: "head", value: "tank" },
      { key: "vg", value: "data" },
      { key: "fs_type", value: "xfs" },
      { key: "capabilities", value: "blk file shared" },
    ]);
    // The head the path already: not said twice.
    expect(poolBandFacts({ pool: { ...POOL, head: "/srv/pool", capabilities: [] }, values: { path: "/srv/pool" } }))
      .toEqual([{ key: "head", value: "/srv/pool" }]);
  });

  test("a node: its own head when another, its use as it reports it; none reported, nothing", () => {
    expect(poolNodeFacts(POOL, PER_NODE.n1, format)).toEqual([{ key: "used", value: "300 MiB / 4096 MiB" }]);
    expect(poolNodeFacts(POOL, PER_NODE.n2, format)).toEqual([
      { key: "head", value: "tank2" },
      { key: "used", value: "100 MiB / 4096 MiB" },
    ]);
    expect(poolNodeFacts(POOL, undefined, format)).toEqual([]);
  });

  test("a volume on the nodes of its consumers, its size its detail", () => {
    expect(volumeNodes(VOLUMES[0])).toEqual(["n1", "n2"]);
    expect(volumeNodes({ path: "x", children: ["ns/svc/a", "ns/svc/b@n1", "ns/svc/c@n1"] })).toEqual(["n1"]);
    // A drbd volume: a copy on each node holding it, whichever its consumer runs on.
    expect(volumeNodes({ path: "x", children: ["ns/svc/a@n2"], nodes: ["n1", "n2", "n3"] })).toEqual(["n1", "n2", "n3"]);
    expect(volumeNodes({ path: "x", children: ["ns/svc/a"], nodes: ["n1", "n2"] })).toEqual(["n1", "n2"]);
    // Unused: drawn apart, wherever it is held.
    expect(volumeNodes({ path: "x", children: [], nodes: ["n1", "n2"] })).toEqual([]);
    const input = poolSketchInput({ pool: POOL, perNode: PER_NODE, values: {}, nodes: ["n1", "n2"], volumes: VOLUMES }, format);
    expect(input.title).toBe("drbdz · drbd");
    expect(input.route).toBeNull();
    expect(input.details).toEqual({ "ns/vol/data": "512 MiB", "ns/vol/logs": "64 MiB", "ns/vol/old": "16 MiB" });
  });

  test("the layout: a volume used on several nodes a pill solid over them, one used by none dashed all along, one on a node under it", () => {
    const layout = poolSketchLayout({ pool: POOL, perNode: PER_NODE, values: {}, nodes: ["n1", "n2", "n3"], volumes: VOLUMES }, format);
    const rows = layout.shared!.rows;
    expect(rows.map((r) => [r.path, r.detail, r.segments.map((s) => s.present)])).toEqual([
      ["ns/vol/data", "512 MiB", [true, true, false]],
      ["ns/vol/old", "16 MiB", [false, false, false]],
    ]);
    expect(layout.shared!.count).toBe(1);
    expect(layout.shared!.unplaced).toBe(1);
    expect(layout.objects.map((o) => [o.node, o.path, o.detail])).toEqual([["n2", "ns/vol/logs", "64 MiB"]]);
    expect(layout.nodes.map((n) => [n.name, n.count, n.shared])).toEqual([["n1", 0, 1], ["n2", 1, 1], ["n3", 0, 0]]);
    // A node reporting the pool says its use; one not, nothing.
    expect(layout.nodes[2].facts).toEqual([]);
    expect(layout.route).toBeNull();
  });
});

describe("pool config", () => {
  const keywords = KEYWORDS as Keyword[];

  test("the types the daemon declares, directory by default", () => {
    const { types, default: first } = sectionTypes(keywords, "pool");
    expect(first).toBe("directory");
    expect(types).toEqual(expect.arrayContaining(["directory", "loop", "vg", "zpool", "drbd", "share", "shm", "virtual", "rados"]));
  });

  test("the fields of a type: the required first, where it takes its volumes from next, a drbd peer address a node", () => {
    expect(sectionFields(keywords, "pool", "vg", POOL_RULES).slice(0, 2).map((f) => [f.key, f.required])).toEqual([
      ["name", true],
      ["fs_type", false],
    ]);
    const freenas = sectionFields(keywords, "pool", "freenas", POOL_RULES);
    expect(freenas.filter((f) => f.required).map((f) => f.key)).toEqual(["array", "diskgroup"]);
    expect(freenas.find((f) => f.key === "compression")?.kind).toBe("choice");
    const drbd = sectionFields(keywords, "pool", "drbd", POOL_RULES);
    expect(drbd.find((f) => f.key === "addr")?.perNode).toBe(true);
    expect(drbd.find((f) => f.key === "max_peers")?.kind).toBe("number");
    // The keys of every type, the type itself left out.
    expect(sectionFields(keywords, "pool", "directory", POOL_RULES).map((f) => f.key)).toEqual(
      expect.arrayContaining(["path", "quota", "mkfs_opt", "mnt_opt", "status_schedule"]),
    );
    expect(sectionFields(keywords, "pool", "directory", POOL_RULES).some((f) => f.key === "type")).toBe(false);
  });
});
