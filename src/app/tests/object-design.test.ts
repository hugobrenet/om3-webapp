import { describe, expect, test } from "vitest";
import {
  designStart,
  designChanges,
  designText,
  parseDesign,
  readValue,
  writeValue,
  poolTypes,
  offeredTypes,
  catalogDrivers,
  provisions,
  type CatalogDriver,
  type DesignDriver,
  usableDrivers,
  isResource,
  rootOnlyKind,
  isUnmanaged,
  withUnmanaged,
  kindDrivers,
  takesResources,
  missingValues,
  nextSectionName,
  offeredKeywords,
  popularKeywords,
  listWords,
  guestDiskChoices,
  parseDriver,
  requiredKeywords,
  withRequired,
  type DesignKeyword,
  type DesignSection,
} from "../object-design";

const KEYWORDS: DesignKeyword[] = [
  { section: "DEFAULT", option: "nodes", text: "The nodes." },
  { section: "DEFAULT", option: "orchestrate", candidates: ["no", "ha", "start"] },
  { section: "", option: "comment" },
  { section: "fs", option: "type", required: true },
  { section: "fs", option: "mnt", types: ["ext4"], required: true },
  { section: "fs", option: "dev", types: ["ext4"], required: true },
  { section: "fs", option: "mnt_opt", types: ["ext4"] },
  { section: "fs", option: "size", types: [] },
  { section: "fs", option: "zone", types: ["zfs"], required: true },
  { section: "fs", option: "old", deprecated: "3.0" },
  { section: "container", option: "privileged", grant: "root", grantAlways: true },
  { section: "container", option: "image", grant: "root", grantAlways: false },
];

const fs = (entries: DesignSection["entries"] = []): DesignSection => ({ name: "fs#1", group: "fs", type: "ext4", entries });

describe("object design", () => {
  test("starts with DEFAULT and env; a driver its group and type", () => {
    expect(designStart().map((s) => s.name)).toEqual(["DEFAULT", "env"]);
    expect(parseDriver("fs.flag")).toEqual({ group: "fs", type: "flag" });
    expect(parseDriver(" app ")).toEqual({ group: "app", type: "" });
  });

  test("a new section of a group, the lowest index free from 1", () => {
    const sections = [...designStart(), fs(), { name: "fs#3", group: "fs", type: "ext4", entries: [] }];
    expect(nextSectionName(sections, "fs")).toBe("fs#2");
    expect(nextSectionName(sections, "app")).toBe("app#1");
  });

  test("the keywords a section must set, of its type, the type aside; seeded with an empty value", () => {
    expect(requiredKeywords(KEYWORDS, fs()).map((k) => k.option)).toEqual(["mnt", "dev"]);
    expect(withRequired(KEYWORDS, fs([{ key: "mnt", value: "/srv" }])).entries).toEqual([
      { key: "mnt", value: "/srv" },
      { key: "dev", value: "" },
    ]);
  });

  test("the keywords offered: of its section and type, not set yet, not deprecated, by name; DEFAULT's those of no section too", () => {
    expect(offeredKeywords(KEYWORDS, fs([{ key: "mnt", value: "/srv" }])).map((k) => k.option)).toEqual(["dev", "mnt_opt", "size"]);
    expect(offeredKeywords(KEYWORDS, designStart()[0]).map((k) => k.option)).toEqual(["comment", "nodes", "orchestrate"]);
  });

  test("root-only hidden: those needing root whatever the value, not those needing it for some", () => {
    const container: DesignSection = { name: "container#1", group: "container", type: "docker", entries: [] };
    expect(offeredKeywords(KEYWORDS, container).map((k) => k.option)).toEqual(["image", "privileged"]);
    expect(offeredKeywords(KEYWORDS, container, true).map((k) => k.option)).toEqual(["image"]);
  });

  test("the file: a section each, the type first, an empty DEFAULT or env left out, an entry with no key too", () => {
    const sections = [
      { name: "DEFAULT", entries: [{ key: "nodes", value: "*" }] },
      { name: "env", entries: [{ key: "", value: "x" }] },
      fs([{ key: "mnt", value: "/srv" }, { key: "dev", value: "/dev/sdb" }]),
    ];
    expect(designText(sections)).toBe("[DEFAULT]\nnodes = *\n\n[fs#1]\ntype = ext4\nmnt = /srv\ndev = /dev/sdb\n");
    expect(designText(designStart())).toBe("");
  });

  test("the drivers of a kind, from the capabilities of a node: its groups, a feature of a driver left out", () => {
    const capabilities = [
      "drivers.resource.app.forking",
      "drivers.resource.container.docker",
      "drivers.resource.container.docker.signal",
      "drivers.resource.fs.flag",
      "drivers.array.hds",
      "node.x.systemd",
    ];
    expect(kindDrivers("svc", capabilities).map((d) => d.name)).toEqual(["app.forking", "container.docker", "fs.flag"]);
    expect(kindDrivers("vol", capabilities).map((d) => d.name)).toEqual(["fs.flag"]);
    expect(kindDrivers("nscfg", capabilities).map((d) => d.name)).toEqual(["claim.network", "claim.pool"]);
    expect(kindDrivers("usr", capabilities)).toEqual([]);
    expect([takesResources("svc"), takesResources("usr")]).toEqual([true, false]);
  });

  test("a file read as a design: the type of a resource its driver, a value continued, comments, the id and the data left out", () => {
    const text = [
      "[DEFAULT]",
      "id = 1234",
      "nodes = n1 n2",
      "# a comment",
      "[fs#1]",
      "type = flag",
      "[app#1]",
      "start = a",
      "  b",
      "[env]",
      "ip@n1 = 10.0.0.1",
      "[data]",
      "key = secret",
    ].join("\n");
    expect(parseDesign(text)).toEqual([
      { name: "DEFAULT", entries: [{ key: "nodes", value: "n1 n2" }] },
      { name: "env", entries: [{ key: "ip@n1", value: "10.0.0.1" }] },
      { name: "fs#1", group: "fs", type: "flag", entries: [] },
      // Continued below its key, the indentation of the lines kept, as om reads it.
      { name: "app#1", group: "app", type: "", entries: [{ key: "start", value: "a\n  b" }] },
    ]);
    expect(parseDesign("", designStart(false))).toEqual([{ name: "DEFAULT", entries: [] }]);
  });

  // Each written by writeValue, created on a cluster, and read back by the daemon
  // (om config get) as the value, but the last, which no quoting can hold.
  const VALUES: [string, string][] = [
    ['sh -c "a ; b"', '`sh -c "a ; b"`'],
    ["echo done # not a comment", "`echo done # not a comment`"],
    ['"quoted"', '`"quoted"`'],
    ["'single'", `"'single'"`],
    ["  leading space", '"  leading space"'],
    ["trailing space  ", '"trailing space  "'],
    ["ends with backslash\\", '"ends with backslash\\"'],
    ["multi\n    indented\n        deeper", "multi\n    indented\n        deeper"],
    ["line1\nline2", "`line1\nline2`"],
    ['back`tick and " # too', '"""back`tick and " # too"""'],
    ["", ""],
    ["a;b#c", "a;b#c"],
    ["x ;y", "`x ;y`"],
  ];

  test("a value written as om writes it: the least quoted that om reads back as the value", () => {
    for (const [value, written] of VALUES) {
      expect(writeValue(value)).toBe(written);
      const [first, ...more] = written.split("\n");
      expect(readValue(first as string, [...more, ""])).toEqual({ value, taken: more.length });
    }
    // None reads back: as is, om reading it cut at its comment.
    expect(writeValue('all """ ` " # kinds')).toBe('all """ ` " # kinds');
  });

  test("a value read as om reads it: comments, quotes, continuations", () => {
    expect(readValue(" a # b", [])).toEqual({ value: "a", taken: 0 });
    expect(readValue(' "a ; b"', [])).toEqual({ value: '"a', taken: 0 });
    expect(readValue(" 'x'", [])).toEqual({ value: "x", taken: 0 });
    expect(readValue(" `a\nb` ignored", [])).toEqual({ value: "a\nb", taken: 0 });
    expect(readValue(" `open", ["middle", "close` after", "next = 1"])).toEqual({ value: "open\nmiddle\nclose", taken: 2 });
    expect(readValue(" a \\", ["  b", "c"])).toEqual({ value: "a b", taken: 1 });
    expect(readValue(" a", ["\tb", "    c", "d = 1"])).toEqual({ value: "a\n\tb\n    c", taken: 2 });
    expect(readValue("", ["  b", ""])).toEqual({ value: "\n  b", taken: 1 });
  });

  test("a design written then read back: each value the same, quoted or on several lines", () => {
    const design: DesignSection[] = [
      { name: "DEFAULT", entries: [{ key: "nodes", value: "n1" }] },
      { name: "env", entries: VALUES.map(([value], i) => ({ key: `k${i}`, value })) },
    ];
    expect(parseDesign(designText(design))).toEqual(design);
  });

  test("the changes of a design: sections gone deleted, keys gone unset, new or changed set, a new section its type first", () => {
    const before = parseDesign("[DEFAULT]\nnodes = n1\norchestrate = ha\n[fs#1]\ntype = flag\n[env]\na = 1\n");
    const after: DesignSection[] = [
      { name: "DEFAULT", entries: [{ key: "nodes", value: "n1 n2" }, { key: "comment", value: "" }] },
      { name: "env", entries: [{ key: "a", value: "1" }, { key: "b", value: "2" }] },
      { name: "app#1", group: "app", type: "forking", entries: [{ key: "start", value: "x" }] },
    ];
    expect(designChanges(before, after)).toEqual({
      set: [
        { keyword: "nodes", value: "n1 n2" },
        { keyword: "env.b", value: "2" },
        { keyword: "app#1.type", value: "forking" },
        { keyword: "app#1.start", value: "x" },
      ],
      unset: ["orchestrate"],
      delete: ["fs#1"],
    });
    expect(designChanges(before, before)).toEqual({ set: [], unset: [], delete: [] });
  });

  test("the popular keywords: of its group first, then minimal, then those of any resource; offered ones alone, at most a few", () => {
    const keywords: DesignKeyword[] = [
      { section: "fs", option: "mnt" },
      { section: "fs", option: "size" },
      { section: "fs", option: "zone", minimal: true },
      { section: "fs", option: "tags" },
      { section: "fs", option: "rare" },
    ];
    const section: DesignSection = { name: "fs#1", group: "fs", type: "zfs", entries: [{ key: "mnt", value: "/srv" }] };
    expect(popularKeywords(keywords, section).map((k) => k.option)).toEqual(["size", "zone", "tags"]);
    expect(popularKeywords(keywords, section, false, 1).map((k) => k.option)).toEqual(["size"]);
    expect(popularKeywords(KEYWORDS, designStart()[0]).map((k) => k.option)).toEqual(["nodes", "orchestrate"]);
  });

  test("the popular keywords of a guest: what it runs on, not what a container of its group takes", () => {
    const keywords: DesignKeyword[] = ["image", "command", "vcpus", "memory", "disk", "network", "cloud_init"].map((option) => ({ section: "container", option }));
    const kvm: DesignSection = { name: "container#1", group: "container", type: "kvm", entries: [] };
    expect(popularKeywords(keywords, kvm).map((k) => k.option)).toEqual(["vcpus", "memory", "disk", "network", "image", "cloud_init"]);
    const docker: DesignSection = { name: "container#2", group: "container", type: "docker", entries: [] };
    expect(popularKeywords(keywords, docker)[0].option).toBe("image");
  });

  test("the words of a list value: the last one is the one being typed", () => {
    expect(listWords("")).toEqual({ done: [], typed: "" });
    expect(listWords("back")).toEqual({ done: [], typed: "back" });
    expect(listWords("backend3 ")).toEqual({ done: ["backend3"], typed: "" });
    expect(listWords("backend3  back")).toEqual({ done: ["backend3"], typed: "back" });
  });

  test("the disks a guest may take: the disk and volume resources of the design", () => {
    expect(guestDiskChoices([
      { name: "DEFAULT", entries: [] },
      { name: "disk#1", group: "disk", type: "lv", entries: [] },
      { name: "volume#1", group: "volume", entries: [] },
      { name: "fs#1", group: "fs", type: "flag", entries: [] },
    ])).toEqual([{ value: "disk#1", info: ["disk.lv"] }, { value: "volume#1", info: ["volume"] }]);
  });

  test("a volume: a driver alone, its type a need offered like any keyword, its size required by its provisioning flag", () => {
    const capabilities = ["drivers.resource.volume", "drivers.resource.volume.shm", "drivers.resource.volume.loop", "drivers.resource.fs.flag"];
    expect(kindDrivers("vol", capabilities).map((d) => [d.name, d.type])).toEqual([["fs.flag", "flag"], ["volume", ""]]);
    expect(poolTypes(capabilities)).toEqual(["loop", "shm"]);
    const keywords: DesignKeyword[] = [
      { section: "volume", option: "type", types: [""] },
      { section: "volume", option: "size", types: [""], provisioning: true, provisioningRequired: true },
      { section: "volume", option: "shared", types: [""] },
    ];
    const volume: DesignSection = { name: "volume#1", group: "volume", type: "", entries: [] };
    expect(requiredKeywords(keywords, volume).map((k) => k.option)).toEqual(["size"]);
    expect(offeredKeywords(keywords, volume).map((k) => k.option)).toEqual(["shared", "size", "type"]);
    const read = parseDesign("[volume#1]\ntype = shm\nsize = 1g\n");
    expect(read.find((x) => x.name === "volume#1")).toEqual({ name: "volume#1", group: "volume", type: "", entries: [{ key: "type", value: "shm" }, { key: "size", value: "1g" }] });
    expect(designText(read)).toBe("[volume#1]\ntype = shm\nsize = 1g\n");
  });

  test("the keywords a provision fails without required, unless the provision is left to the user; the other provisioning ones offered first", () => {
    const keywords: DesignKeyword[] = [
      { section: "disk", option: "type", required: true },
      { section: "disk", option: "name", required: true },
      { section: "disk", option: "size", provisioning: true, provisioningRequired: true },
      { section: "disk", option: "create_options", provisioning: true },
      { section: "disk", option: "provision" },
      { section: "disk", option: "tags" },
      { section: "volume", option: "pool", provisioning: true, types: [""] },
      { section: "volume", option: "size", provisioning: true, provisioningRequired: true, types: [""] },
    ];
    const lv: DesignSection = { name: "disk#1", group: "disk", type: "lv", entries: [{ key: "size", value: "1g" }] };
    expect(requiredKeywords(keywords, lv).map((k) => k.option)).toEqual(["name", "size"]);
    expect(popularKeywords(keywords, lv).map((k) => k.option)).toEqual(["name", "create_options", "tags"]);
    // The provision a box of its own, not a keyword offered.
    expect(offeredKeywords(keywords, lv).map((k) => k.option)).toEqual(["create_options", "name", "tags"]);
    const seeded = withRequired(keywords, lv);
    const mine = withUnmanaged(keywords, seeded, true);
    expect(isUnmanaged(mine)).toBe(true);
    // The empty provisioning keywords dropped, those set kept; the required ones still.
    expect(mine.entries).toEqual([{ key: "size", value: "1g" }, { key: "name", value: "" }, { key: "provision", value: "false" }]);
    expect(requiredKeywords(keywords, mine).map((k) => k.option)).toEqual(["name"]);
    expect(isUnmanaged(withUnmanaged(keywords, mine, false))).toBe(false);
    const volume: DesignSection = { name: "volume#1", group: "volume", type: "", entries: [] };
    expect(requiredKeywords(keywords, volume).map((k) => k.option)).toEqual(["size"]);
  });

  const CATALOG: CatalogDriver[] = [
    { name: "container.docker", group: "container", type: "docker", features: ["start", "stop"], available: true },
    { name: "container.kvm", group: "container", type: "kvm", available: false },
    { name: "container.lxc", group: "container", type: "lxc", available: true },
    { name: "container.oci", group: "container", type: "oci", selects: ["container.docker", "container.podman"], available: true },
    { name: "container.podman", group: "container", type: "podman", available: true },
    { name: "disk.lvm", group: "disk", type: "lvm", aliasOf: "disk.vg", available: true },
    { name: "disk.vg", group: "disk", type: "vg", features: ["provision", "start", "stop"], available: true },
    { name: "fs.nfs", group: "fs", type: "nfs", features: ["start", "stop"], available: true },
    { name: "pool.vg", group: "pool", type: "vg", available: true },
    { name: "volume", group: "volume", type: "", features: ["provision", "start"], available: true },
  ];

  test("the drivers of the catalog: of the groups of the kind, the node's, no deprecated alias", () => {
    expect(catalogDrivers("svc", CATALOG).map((d) => d.name)).toEqual([
      "container.docker", "container.lxc", "container.oci", "container.podman", "disk.vg", "fs.nfs", "volume",
    ]);
    expect(catalogDrivers("vol", CATALOG).map((d) => d.name)).toEqual(["disk.vg", "fs.nfs", "volume"]);
  });

  test("a virtual driver first, the drivers it picks among its second choices; alone without it", () => {
    const containers = catalogDrivers("svc", CATALOG).filter((d) => d.group === "container");
    expect(offeredTypes(containers).map((o) => [o.driver.type, o.alternatives.map((a) => a.type)])).toEqual([
      ["oci", ["docker", "podman"]],
      ["lxc", []],
    ]);
    // Podman not on the node: oci its second choice docker.
    expect(offeredTypes(containers.filter((d) => d.type !== "podman")).map((o) => o.alternatives.map((a) => a.type))).toEqual([["docker"], []]);
    // No oci: each a choice of its own.
    expect(offeredTypes(containers.filter((d) => d.type !== "oci")).map((o) => o.driver.type)).toEqual(["docker", "lxc", "podman"]);
  });

  test("the drivers only root may use hidden from a design without root; those only root may provision kept", () => {
    const drivers: DesignDriver[] = [
      { name: "disk.lv", group: "disk", type: "lv", grant: "root" },
      { name: "fs.flag", group: "fs", type: "flag", grant: "" },
      { name: "disk.x", group: "disk", type: "x", grant: "", provisionGrant: "root" },
      { name: "app.forking", group: "app", type: "forking" },
    ];
    expect(usableDrivers(drivers, true).map((d) => d.name)).toEqual(["fs.flag", "disk.x", "app.forking"]);
    expect(usableDrivers(drivers, false)).toHaveLength(4);
  });

  test("whether a resource provisions: as its driver's features say; yes when unknown", () => {
    const drivers = catalogDrivers("svc", CATALOG);
    const section = (group: string, type: string): DesignSection => ({ name: `${group}#1`, group, type, entries: [] });
    expect(provisions(drivers, section("disk", "vg"))).toBe(true);
    expect(provisions(drivers, section("fs", "nfs"))).toBe(false);
    expect(provisions(drivers, section("volume", ""))).toBe(true);
    // Not in the catalog, or no catalog: told nothing, so yes.
    expect(provisions(drivers, section("app", "forking"))).toBe(true);
    expect(provisions(null, section("fs", "nfs"))).toBe(true);
    expect(provisions(drivers, { name: "DEFAULT", entries: [] })).toBe(false);
  });

  test("a resource of its kind's groups, not a heartbeat nor the node of the cluster's; the cluster configuration root's alone", () => {
    expect(isResource("svc", { group: "fs" })).toBe(true);
    expect(isResource("ccfg", { group: "hb" })).toBe(false);
    expect(isResource("svc", {})).toBe(false);
    expect([rootOnlyKind("ccfg"), rootOnlyKind("svc")]).toEqual([true, false]);
  });

  test("the required entries left without a value", () => {
    expect(missingValues([withRequired(KEYWORDS, fs([{ key: "mnt", value: "/srv" }]))], KEYWORDS)).toEqual([{ section: "fs#1", key: "dev" }]);
  });
});
