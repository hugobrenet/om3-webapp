import { describe, expect, test } from "vitest";
import {
    impliedType,
    strategyLeftovers,
  designStart,
  designChanges,
  shownKeyword,
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
  clusterSectionChoices, keywordItems, keywordGroupsOf, groupKeywords, designLookup, impliedStrategy, strategyBySelector, strategyOptions, withheldOptions, referencePicks, referenceWords, referenceRid, strategyRequirements, strategyReason, followedStrategies, strategiesClash, unmetDepends, strategySelectorWrites, prominentStrategyGroup, keywordSummary} from "../object-design";

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

  test("a key ending at its first \"=\" or \":\", a section header commented after its \"]\": as om reads them", () => {
    const text = [
      "[DEFAULT]",
      "nodes = n1",
      "[app#1]",
      "start_timeout: 1m",
      "start = /bin/x --opt=1",
      "stop: /bin/x --opt=1",
      "[fs#1]   # the data",
      "type = flag",
      "mnt = /srv",
    ].join("\n");
    expect(parseDesign(text)).toEqual([
      { name: "DEFAULT", entries: [{ key: "nodes", value: "n1" }] },
      { name: "env", entries: [] },
      {
        name: "app#1",
        group: "app",
        type: "",
        entries: [
          { key: "start_timeout", value: "1m" },
          { key: "start", value: "/bin/x --opt=1" },
          { key: "stop", value: "/bin/x --opt=1" },
        ],
      },
      { name: "fs#1", group: "fs", type: "flag", entries: [{ key: "mnt", value: "/srv" }] },
    ]);
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
        { keyword: "DEFAULT.nodes", value: "n1 n2" },
        { keyword: "env.b", value: "2" },
        { keyword: "app#1.type", value: "forking" },
        { keyword: "app#1.start", value: "x" },
      ],
      unset: ["DEFAULT.orchestrate"],
      delete: ["fs#1"],
    });
    expect(designChanges(before, before)).toEqual({ set: [], unset: [], delete: [] });
  });

  test("a keyword of DEFAULT sent with its section, a scope with dots read by om as written; shown alone", () => {
    // Alone, om3 would read nodes@n1.acme.com as section.option, cut where it has no dot.
    const before = parseDesign("[DEFAULT]\nnodes@n1.acme.com = n1\n");
    const after: DesignSection[] = [{ name: "DEFAULT", entries: [{ key: "nodes@n2.acme.com", value: "n2" }] }, { name: "env", entries: [] }];
    expect(designChanges(before, after)).toEqual({
      set: [{ keyword: "DEFAULT.nodes@n2.acme.com", value: "n2" }],
      unset: ["DEFAULT.nodes@n1.acme.com"],
      delete: [],
    });
    expect(shownKeyword("DEFAULT.nodes@n1.acme.com")).toBe("nodes@n1.acme.com");
    expect(shownKeyword("fs#1.size")).toBe("fs#1.size");
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

describe("clusterSectionChoices", () => {
  const keywords = [
    { section: "cluster", option: "name" },
    { section: "ai", option: "agent_url" },
    { section: "pool", option: "type", candidates: ["drbd", "directory"] },
    { section: "hb", option: "type" },
    { section: "arbitrator", option: "timeout" },
    { section: "DEFAULT", option: "nodes" },
    { section: "", option: "comment" },
  ];

  test("the sections of their own not there, then the kinds of the sections of several, their types listed", () => {
    expect(clusterSectionChoices(keywords, [{ name: "DEFAULT", entries: [] }, { name: "cluster", group: "cluster", entries: [] }])).toEqual([
      { section: "ai", indexed: false, typed: false, types: [] },
      { section: "arbitrator", indexed: true, typed: false, types: [] },
      { section: "hb", indexed: true, typed: true, types: [] },
      { section: "pool", indexed: true, typed: true, types: ["directory", "drbd"] },
    ]);
  });

  test("a section of several offered with some there: one more, by another name", () => {
    expect(clusterSectionChoices(keywords, [{ name: "pool#ceph", group: "pool", entries: [] }]).map((c) => c.section)).toContain("pool");
  });
});


describe("the groups of the keywords, and their strategies", () => {
    const GROUPS = [
        {id: "other", driver: "", name: "Other", order: 1000},
        {id: "availability", driver: "", name: "Availability", order: 100},
        {id: "addressing", driver: "ip.netns", name: "Addressing", order: 10, strategies: [
            {id: "static", name: "Static address", uses: ["name"], excludes: ["network", "addr"], when: []},
            {id: "ipam", name: "Address drawn from a network", uses: ["network", "addr"], excludes: ["name"], when: []},
        ]},
    ];
    const kw = (option, group) => ({section: "ip", option, ...(group ? {group} : {})});
    const IP = {name: "ip#1", group: "ip", type: "netns", entries: []};

    test("an answer's groups kept beside its keywords; none from an older daemon", () => {
        const items = keywordItems({items: [kw("name", "addressing")], groups: GROUPS});
        expect(keywordGroupsOf(items)).toBe(GROUPS);
        expect(keywordGroupsOf(keywordItems({items: [kw("name")]}))).toEqual([]);
        expect(keywordItems(null)).toEqual([]);
    });

    test("keywords under their groups, in order, a keyword of no group known under other", () => {
        const grouped = groupKeywords([kw("restart", "availability"), kw("comment"), kw("name", "addressing"), kw("netmask", "addressing")], GROUPS);
        expect(grouped.map((g) => [g.group.id, g.keywords.map((k) => k.option)])).toEqual([
            ["addressing", ["name", "netmask"]],
            ["availability", ["restart"]],
            ["other", ["comment"]],
        ]);
        expect(groupKeywords([kw("name")], [])).toEqual([{keywords: [kw("name")]}]);
    });

    test("the strategy a section follows: by the keywords it sets, else none yet", () => {
        const lookup = designLookup(IP, [IP]);
        expect(impliedStrategy(GROUPS[2], IP, lookup)).toBeUndefined();
        const withNetwork = {...IP, entries: [{key: "network", value: "default"}]};
        expect(impliedStrategy(GROUPS[2], withNetwork, designLookup(withNetwork, [withNetwork]))?.id).toBe("ipam");
        const scoped = {...IP, entries: [{key: "name@n1", value: "10.0.0.1"}]};
        expect(impliedStrategy(GROUPS[2], scoped, designLookup(scoped, [scoped]))?.id).toBe("static");
    });

    test("by a selector keyword when the strategies say which, its value of the section or of DEFAULT", () => {
        const group = {id: "g", strategies: [
            {id: "flex", uses: ["a"], when: ["topology=flex"]},
            {id: "failover", uses: ["b"], when: [{Key: "DEFAULT.topology", Op: "!=", Value: "flex"}]},
        ]};
        const DEFAULT = {name: "DEFAULT", entries: [{key: "topology", value: "flex"}]};
        expect(impliedStrategy(group, IP, designLookup(IP, [DEFAULT, IP]))?.id).toBe("flex");
        const failover = {name: "DEFAULT", entries: [{key: "topology", value: "failover"}]};
        expect(impliedStrategy(group, IP, designLookup(IP, [failover, IP]))?.id).toBe("failover");
        expect(strategyBySelector(group)).toBe(true);
        expect(strategyBySelector(GROUPS[2])).toBe(false);
    });

    test("the quiesce of a container: its strategy chosen by the value of quiesce, unset meaning command", () => {
        const QUIESCE = {id: "quiesce", driver: "container.docker", strategies: [
            {id: "pause", when: ["quiesce=pause"], excludes: ["quiesce_input", "quiesce_ready", "resume_input", "quiesce_timeout"]},
            {id: "command", uses: ["quiesce_input"], when: ["quiesce!=pause"]},
        ]};
        const container = (entries) => ({name: "container#1", group: "container", type: "docker", entries});
        const paused = container([{key: "quiesce", value: "pause"}]);
        expect(impliedStrategy(QUIESCE, paused, designLookup(paused, [paused]))?.id).toBe("pause");
        expect([...withheldOptions([QUIESCE], paused, designLookup(paused, [paused]))].sort()).toEqual(["quiesce_input", "quiesce_ready", "quiesce_timeout", "resume_input"]);
        const plain = container([]);
        expect(impliedStrategy(QUIESCE, plain, designLookup(plain, [plain]))?.id).toBe("command");
        expect([...withheldOptions([QUIESCE], plain, designLookup(plain, [plain]))]).toEqual([]);
        expect(strategyBySelector(QUIESCE)).toBe(true);
    });

    test("the install of a kvm guest: virtinst chosen, the keywords of the others and its hardware left out", () => {
        const INSTALL = {id: "install", driver: "container.kvm", strategies: [
            {id: "image", uses: ["image", "cloud_init"], excludes: ["cdrom", "virtinst"], when: []},
            {id: "cdrom", uses: ["cdrom"], excludes: ["image", "cloud_init", "virtinst"], when: []},
            {id: "virtinst", uses: ["virtinst"], excludes: ["vcpus", "memory", "disk", "bridge", "network", "osinfo", "image", "cdrom", "cloud_init", "virtinst_args"], when: []},
        ]};
        const guest = {name: "container#1", group: "container", type: "kvm", entries: []};
        const lookup = designLookup(guest, [guest]);
        expect(impliedStrategy(INSTALL, guest, lookup)).toBeUndefined();
        expect(withheldOptions([INSTALL], guest, lookup).has("vcpus")).toBe(false);
        const held = withheldOptions([INSTALL], guest, lookup, {install: "virtinst"});
        expect(held.has("vcpus")).toBe(true);
        expect(held.has("image")).toBe(true);
        const imaged = {...guest, entries: [{key: "image", value: "debian"}]};
        expect(impliedStrategy(INSTALL, imaged, designLookup(imaged, [imaged]))?.id).toBe("image");
    });

    test("held back: every strategy's keywords until one is chosen, then those it excludes", () => {
        const lookup = designLookup(IP, [IP]);
        expect([...withheldOptions(GROUPS, IP, lookup)].sort()).toEqual(["addr", "name", "network"]);
        expect([...withheldOptions(GROUPS, IP, lookup, {addressing: "ipam"})]).toEqual(["name"]);
        expect([...strategyOptions(GROUPS[2])].sort()).toEqual(["addr", "name", "network"]);
    });
});

describe("the keywords naming resources of the object", () => {
    const S = (name, group, type) => ({name, group, type, entries: []});
    const sections = [S("DEFAULT"), S("container#0", "container", "oci"), S("container#db", "container", "docker"), S("fs#1", "fs", "flag"), S("subset#container:oc3", "subset")];

    test("the resources of the design of its groups, the section itself left out, its special values after", () => {
        const netns = {section: "container", option: "netns", candidates: ["", "none", "host"], references: {groups: ["container"], shape: "rid"}};
        expect(referencePicks(netns, sections, sections[2], "svc", "special")).toEqual([
            {value: "container#0", info: ["container.oci"]},
            {value: "none", info: ["special"]},
            {value: "host", info: ["special"]},
        ]);
    });

    test("any group when it names none; no picks for a keyword naming no resource", () => {
        const requires = {section: "fs", option: "start_requires", references: {groups: [], shape: "requires"}};
        expect(referencePicks(requires, sections, sections[3], "svc").map((p) => p.value)).toEqual(["container#0", "container#db"]);
        expect(referencePicks({section: "fs", option: "mnt"}, sections, sections[3], "svc")).toEqual([]);
    });

    test("the words of a requirement, its states with their spaces part of its resource", () => {
        expect(referenceWords("container#db(up) fs#1(down,stdby down) con")).toEqual({done: ["container#db(up)", "fs#1(down,stdby down)"], typed: "con"});
        expect(referenceWords("container#db(up) ")).toEqual({done: ["container#db(up)"], typed: ""});
        expect(referenceWords("fs#1(down,stdby")).toEqual({done: [], typed: "fs#1(down,stdby"});
        expect(referenceWords("")).toEqual({done: [], typed: ""});
        expect(referenceRid("fs#1(down,stdby down)")).toBe("fs#1");
    });
});

describe("the strategies a section must follow", () => {
    const ADDRESSING = {id: "addressing", name: "Addressing", required: true, strategies: [
        {id: "static", name: "Static address", uses: ["name"], excludes: ["network", "addr"], requires: ["dev"], when: []},
        {id: "ipam", name: "Address drawn from a network", uses: ["network", "addr"], excludes: ["name"], requires: [], when: []},
    ]};
    const ip = (entries) => ({name: "ip#1", group: "ip", type: "netns", entries});
    const needs = (section, chosen = {}, sections = [section]) =>
        strategyRequirements([ADDRESSING], section, designLookup(section, sections), chosen).map((n) => [n.strategy?.id ?? null, n.option ?? null]);

    test("a strategy to choose, while none is followed nor picked", () => {
        expect(needs(ip([{key: "netns", value: "container#1"}]))).toEqual([[null, null]]);
    });

    test("picked: one of the keywords it uses, and each it requires", () => {
        expect(needs(ip([]), {addressing: "static"})).toEqual([["static", "name"], ["static", "dev"]]);
        expect(needs(ip([]), {addressing: "ipam"})).toEqual([["ipam", "network"]]);
    });

    test("an empty keyword tells no strategy, as the daemon counts it", () => {
        const empty = ip([{key: "name", value: ""}, {key: "network", value: "default"}]);
        expect(impliedStrategy(ADDRESSING, empty, designLookup(empty, [empty]))?.id).toBe("ipam");
        const blank = ip([{key: "name", value: " "}]);
        expect(impliedStrategy(ADDRESSING, blank, designLookup(blank, [blank]))).toBeUndefined();
    });

    test("followed by the keywords set: only what it requires left; set in DEFAULT counts, an empty entry does not", () => {
        expect(needs(ip([{key: "name", value: "10.0.0.1"}]))).toEqual([["static", "dev"]]);
        expect(needs(ip([{key: "name@n1", value: "10.0.0.1"}, {key: "dev", value: ""}]))).toEqual([["static", "dev"]]);
        const DEFAULT = {name: "DEFAULT", entries: [{key: "dev", value: "eth0"}]};
        const section = ip([{key: "name", value: "10.0.0.1"}]);
        expect(needs(section, {}, [DEFAULT, section])).toEqual([]);
        expect(needs(ip([{key: "network", value: "default"}]))).toEqual([]);
    });

    test("a group not required asks nothing", () => {
        expect(strategyRequirements([{...ADDRESSING, required: false}], ip([]), designLookup(ip([]), [ip([])]))).toEqual([]);
    });
});

describe("strategies some of which a selector chooses, the credentials of a 3par array", () => {
    const CREDENTIALS = {id: "credentials", driver: "array.hp3par", strategies: [
        {id: "ssh", name: "SSH key", uses: ["key", "username"], excludes: ["pwf"], requires: [], when: []},
        {id: "cli", name: "Command line", uses: ["pwf"], excludes: ["key", "username"], requires: [], when: ["method=cli"]},
    ]};
    const array = (entries) => ({name: "array#3par1", group: "array", type: "hp3par", entries});
    const followed = (section) => {
        const strategy = impliedStrategy(CREDENTIALS, section, designLookup(section, [section]));
        return strategy && [strategy.id, strategyReason(strategy, section)];
    };

    test("the selector's when it holds; else the one whose keywords are set; else the one it leaves, by default", () => {
        expect(followed(array([{key: "method", value: "cli"}]))).toEqual(["cli", "selector"]);
        expect(followed(array([{key: "key", value: "/etc/key"}]))).toEqual(["ssh", "keywords"]);
        expect(followed(array([]))).toEqual(["ssh", "default"]);
        expect(followed(array([{key: "method", value: "ssh"}]))).toEqual(["ssh", "default"]);
    });

    test("the keywords of the other strategy held back, those of the one followed offered", () => {
        const none = array([]);
        expect([...withheldOptions([CREDENTIALS], none, designLookup(none, [none]))]).toEqual(["pwf"]);
        const cli = array([{key: "method", value: "cli"}]);
        expect([...withheldOptions([CREDENTIALS], cli, designLookup(cli, [cli]))].sort()).toEqual(["key", "username"]);
    });
});

describe("strategies followed together, the certificates of an acme task", () => {
    const CERTIFICATES = {id: "certificates", driver: "task.acme", required: true, strategies: [
        {id: "secs", name: "From secs", uses: ["secs"], excludes: [], requires: [], when: []},
        {id: "domains", name: "Of domains", uses: ["domains_from", "domains_to"], excludes: [], requires: ["domains_from", "domains_to"], when: []},
    ]};
    const task = (entries) => ({name: "task#acme", group: "task", type: "acme", entries});
    const needs = (section, chosen = {}) =>
        strategyRequirements([CERTIFICATES], section, designLookup(section, [section]), chosen).map((n) => [n.strategy?.id ?? null, n.option ?? null]);
    const followed = (section, chosen) => followedStrategies(CERTIFICATES, section, designLookup(section, [section]), chosen).map((s) => s.id);

    test("neither set: a strategy to choose", () => {
        expect(needs(task([]))).toEqual([[null, null]]);
    });

    test("both followed together, neither leaving the other", () => {
        expect(strategiesClash(CERTIFICATES.strategies[0], CERTIFICATES.strategies[1])).toBe(false);
        const both = task([{key: "secs", value: "ns1/sec/a"}, {key: "domains_from", value: "a.example"}, {key: "domains_to", value: "ns1/sec/b"}]);
        expect(followed(both)).toEqual(["secs", "domains"]);
        expect(needs(both)).toEqual([]);
        expect(followed(task([{key: "secs", value: "ns1/sec/a"}]), "domains")).toEqual(["secs", "domains"]);
    });

    test("domains with one of its two keywords: the other required", () => {
        expect(needs(task([{key: "domains_from", value: "a.example"}]))).toEqual([["domains", "domains_to"]]);
        expect(needs(task([]), {certificates: "domains"})).toEqual([["domains", "domains_from"], ["domains", "domains_to"]]);
    });

    test("exclusive strategies still one at a time: a pick clashing with one told is not followed", () => {
        const ADDRESSING = {id: "addressing", required: true, strategies: [
            {id: "static", uses: ["name"], excludes: ["network", "addr"], requires: ["dev"], when: []},
            {id: "ipam", uses: ["network", "addr"], excludes: ["name"], requires: [], when: []},
        ]};
        const ip = {name: "ip#1", group: "ip", type: "netns", entries: [{key: "network", value: "default"}]};
        expect(followedStrategies(ADDRESSING, ip, designLookup(ip, [ip]), "static").map((s) => s.id)).toEqual(["ipam"]);
    });
});

describe("the conditions a keyword applies under", () => {
    const values = (map) => (option, own) => map[own ? `.${option}` : option];

    test("judged on the value set, inherited or by default; the condition failing said", () => {
        const flexMin = {section: "DEFAULT", option: "flex_min", depends: ["topology=flex"]};
        expect(unmetDepends(flexMin, values({topology: "failover"}))).toBe("topology=flex");
        expect(unmetDepends(flexMin, values({topology: "flex"}))).toBeUndefined();
        expect(unmetDepends(flexMin, values({topology: "FLEX"}))).toBeUndefined();
    });

    test("an option of the section itself by a leading dot; skipped when it has no value at all", () => {
        const vlan = {section: "ip", option: "vlan_tag", depends: [".mode=ovs"]};
        expect(unmetDepends(vlan, values({".mode": "bridge"}))).toBe("mode=ovs");
        expect(unmetDepends(vlan, values({".mode": "ovs"}))).toBeUndefined();
        expect(unmetDepends(vlan, values({}))).toBeUndefined();
    });

    test("a condition of inequality; a keyword of none applies anywhere", () => {
        expect(unmetDepends({option: "x", depends: ["quiesce!=pause"]}, values({quiesce: "pause"}))).toBe("quiesce!=pause");
        expect(unmetDepends({option: "x", depends: ["quiesce!=pause"]}, values({quiesce: "command"}))).toBeUndefined();
        expect(unmetDepends({option: "y"}, values({}))).toBeUndefined();
        expect(unmetDepends(undefined, values({}))).toBeUndefined();
    });
});

describe("a strategy chosen by writing its selector", () => {
    const PAUSE = {id: "pause", when: ["quiesce=pause"]};
    const COMMAND = {id: "command", when: ["quiesce!=pause"]};
    const writes = (strategy, values, set = {}, keyword = {}) => strategySelectorWrites(
        strategy,
        (option) => values[option],
        (option) => Boolean(set[option]),
        (option) => keyword[option],
    );

    test("an equality: the value written, nothing when it holds", () => {
        expect(writes(PAUSE, {})).toEqual([{option: "quiesce", value: "pause"}]);
        expect(writes(PAUSE, {quiesce: "pause"})).toEqual([]);
    });

    test("an inequality: the value set removed when the default holds, else another candidate, else none", () => {
        expect(writes(COMMAND, {quiesce: "pause"}, {quiesce: true}, {quiesce: {option: "quiesce"}})).toEqual([{option: "quiesce", value: null}]);
        expect(writes(COMMAND, {quiesce: "pause"}, {quiesce: true}, {quiesce: {option: "quiesce", default: "pause", candidates: ["pause", "command"]}})).toEqual([{option: "quiesce", value: "command"}]);
        expect(writes(COMMAND, {quiesce: "pause"}, {}, {quiesce: {option: "quiesce", default: "pause"}})).toBeUndefined();
        expect(writes(COMMAND, {})).toEqual([]);
    });
});

describe("a strategy group on its section, or in the keywords to add", () => {
    const QUIESCE = {id: "quiesce", strategies: [{id: "pause", uses: [], excludes: ["quiesce_input"], when: ["quiesce=pause"]}, {id: "command", uses: ["quiesce_input"], when: ["quiesce!=pause"]}]};
    const known = [{section: "container", option: "quiesce", group: "quiesce"}, {section: "container", option: "quiesce_input", group: "quiesce"}, {section: "container", option: "image", group: "image"}];
    const container = (entries) => ({name: "container#1", group: "container", type: "docker", entries});

    test("in the keywords to add while nothing of it is set nor needed", () => {
        expect(prominentStrategyGroup(QUIESCE, container([{key: "image", value: "nginx"}]), known, new Set(["image", "command"]))).toBe(false);
    });

    test("on the section: required, a keyword of it set, its selector set, or one of it needed", () => {
        expect(prominentStrategyGroup({...QUIESCE, required: true}, container([]), known, new Set())).toBe(true);
        expect(prominentStrategyGroup(QUIESCE, container([{key: "quiesce_input", value: "x"}]), known, new Set())).toBe(true);
        expect(prominentStrategyGroup(QUIESCE, container([{key: "quiesce", value: "pause"}]), known, new Set())).toBe(true);
        expect(prominentStrategyGroup(QUIESCE, container([{key: "quiesce", value: ""}]), known, new Set())).toBe(false);
        expect(prominentStrategyGroup(QUIESCE, container([]), known, new Set(["quiesce"]))).toBe(true);
    });
});

describe("the summary of a keyword's documentation", () => {
    test("its first paragraph, its wrapped lines joined, its markdown marks dropped", () => {
        expect(keywordSummary("If set to `false`, the default *rollback on start action error* behaviour is\ninhibited, leaving the service in error state.\n")).toBe(
            "If set to false, the default rollback on start action error behaviour is inhibited, leaving the service in error state.",
        );
    });

    test("ended by an ellipsis when the documentation goes on past it, its colon dropped", () => {
        expect(keywordSummary("Disables the object instance:\n\n* A disabled instance is not started.\n* Nor stopped.")).toBe("Disables the object instance…");
        expect(keywordSummary("One sentence.\n\nAnother.")).toBe("One sentence…");
    });

    test("a documentation opening on a list: its items", () => {
        expect(keywordSummary("* `failover`\n\n  The service is allowed to be up on one node at a time.\n\n* `flex`\n\n  The service can be up on `flex_target` nodes.\n")).toBe("failover, flex");
    });

    test("nothing to summarize: empty", () => {
        expect(keywordSummary(undefined)).toBe("");
        expect(keywordSummary("  \n ")).toBe("");
    });
});

describe("impliedType", () => {
    test("the one type the keywords of a type are of; none when they tell none or several", () => {
        expect(impliedType([{section: "ip", option: "type"}, {section: "ip", option: "name", types: ["host"]}] as never)).toBe("host");
        expect(impliedType([{section: "ip", option: "type", types: []}] as never)).toBe("");
        expect(impliedType([{section: "fs", option: "mnt", types: ["flag", "ext4"]}] as never)).toBe("");
    });
});

describe("clusterSectionChoices", () => {
    test("a section of the cluster taking a name, a unix group as a pool, among those of several: uxgroup#<group>", () => {
        const keywords = [
            {section: "uxgroup", option: "grant"},
            {section: "pool", option: "type", candidates: ["directory"]},
            {section: "syslog", option: "host"},
        ] as never;
        const choices = clusterSectionChoices(keywords, [{name: "uxgroup#ops", entries: []}] as never);
        expect(choices.map((c) => [c.section, c.indexed])).toEqual([["syslog", false], ["pool", true], ["uxgroup", true]]);
    });
});

describe("strategyLeftovers", () => {
    const addressing = {
        id: "addressing", driver: "ip.netns", name: "Addressing", order: 10, required: true, strategies: [
            {id: "static", name: "Static", uses: ["name"], excludes: ["network"], requires: ["dev"], when: []},
            {id: "ipam", name: "Drawn", uses: ["network"], excludes: ["name"], requires: [], when: []},
        ],
    } as never;
    test("another strategy chosen: the keywords of the former left empty dropped, those given a value kept", () => {
        const section = {name: "ip#1", group: "ip", type: "netns", entries: [
            {key: "netns", value: ""}, {key: "name", value: ""}, {key: "dev", value: "br0"},
        ]} as never;
        expect(strategyLeftovers(addressing, "ipam", section)).toEqual(["name"]);
        // Its own keywords never dropped; a keyword of no strategy neither.
        expect(strategyLeftovers(addressing, "static", section)).toEqual([]);
    });
});
