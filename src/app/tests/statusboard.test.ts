import { afterEach, describe, expect, test, vi } from "vitest";
import { buildBoard, marker, mixedStates, resourceNotes, splitLabels, words, type Board, type ObjectData, type Text } from "../statusboard";
import { selectionEdges } from "../StatusBoard";
import dns from "./fixtures/system-svc-dns.json";
import foo001 from "./fixtures/root-svc-foo001.json";

afterEach(() => {
  vi.useRealTimers();
});

const plain = (text: Text) => text.map((s) => s.text).join("");

/** Words cut to lines of `width` at most, as om wraps the notes. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const w of text.split(/\s+/).filter((x) => x !== "")) {
    if (current === "") current = w;
    else if (current.length + 1 + w.length > Math.max(20, width)) {
      lines.push(current);
      current = w;
    } else current += ` ${w}`;
  }
  lines.push(current);
  return lines;
}

/**
 * The board as om writes it without a terminal (`core/statusboard` render, width
 * 0): the same model must give the same text, column for column.
 */
function toText(board: Board): string {
  const name = (r: Board["rows"][number]) => "  ".repeat(r.indent) + r.name;
  let nameW = "    container#1".length;
  let typW = 0;
  const nodeW = board.nodes.map((n) => n.name.length + (n.frozen ? 1 : 0));
  for (const r of board.rows) {
    nameW = Math.max(nameW, name(r).length);
    typW = Math.max(typW, r.typ.length);
    r.cells.forEach((c, i) => (nodeW[i] = Math.max(nodeW[i] ?? 0, plain(c).length)));
  }
  let descStart = 2 + nameW + 2 + typW + 2;
  for (const w of nodeW) descStart += w + 2;
  const col = 2 + nameW + 2;
  const header = [[board.path, ...(board.facts.length > 0 ? [board.facts.map((f) => f.value).join(" · ")] : [])].join("   ")];
  for (const f of board.fields) header.push(`  ${f.name}${" ".repeat(Math.max(1, col - 2 - f.name.length))}${plain(f.value)}`);
  const width = Math.max(...header.map((l) => l.length), descStart + 20);
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));
  const line = (n: string, typ: string, cells: string[], desc: string) =>
    (`  ${pad(n, nameW)}  ` + nodeW.map((w, i) => `${pad(cells[i] ?? "", w)}  `).join("") + `${pad(typ, typW)}  ${desc}`).trimEnd();
  const out = [...header, "", line("", "", board.nodes.map((n) => n.name + (n.frozen ? "*" : "")), "")];
  for (const r of board.rows) out.push(r.blank ? "" : line(name(r), r.typ, r.cells.map(plain), plain(r.desc)));
  if (board.notes.length > 0) {
    out.push("", " notes");
    for (const g of board.notes) {
      for (const h of g.heads) {
        const level = g.level === "error" ? "error" : g.level === "warn" ? "warn " : "info ";
        out.push(` ${pad(h.marker, 3)}${level} ${h.subject}${h.nodes === "" ? "" : `   ${h.nodes}`}`);
      }
      for (const l of wrap(g.text, width - 7)) out.push(`       ${l}`);
    }
  }
  return `${out.join("\n")}\n`;
}

describe("status board", () => {
  test("a flex service down on its two nodes reads as om shows it", () => {
    const board = buildBoard({ path: "system/svc/dns", object: dns as ObjectData });
    expect(toText(board)).toBe(`system/svc/dns   flex · ha · nodes order
  avail                 down
  overall               down

                        dev3n1        dev3n2
  instance              X             X                     0/2
    monitor             start failed  start failed

  resources
    volume#1            X ¹           X ¹           volume  dns
    container#config    /             /             docker  docker.io/busybox:1.31.1
    container#janitor   X             X             docker  ghcr.io/opensvc/pdns_janitor:3
    container#recursor  X             X             docker  docker.io/powerdns/pdns-recursor-48:4.8.4
    container#server    X             X             docker  docker.io/powerdns/pdns-auth-47:4.7.4
    sync#i0             / D           / D           rsync

 notes
 ·  error monitor   dev3n1
    error monitor   dev3n2
       start failed: the orchestration gave up, clear the instance to retry
 ¹  info  volume#1   all
       system/vol/dns avail down
`);
    // The colors om gives: the downs red, the instances missing; the failed monitor red.
    const instance = board.rows.find((r) => r.name === "instance");
    expect(instance?.cells[0]?.[0]).toEqual({ text: "X", tone: "error", status: "down" });
    expect(board.rows.find((r) => r.name === "monitor")?.cells[0]).toEqual([{ text: "start failed", tone: "error" }]);
    expect(board.rows.find((r) => r.name === "sync#i0")?.cells[0]).toEqual([
      { text: "/", tone: "secondary", status: "n/a" },
      { text: " " },
      { text: "D", flag: true },
    ]);
    expect(board.fields[0]?.value).toEqual([{ text: "down", tone: "error", status: "down" }]);
    expect(board.rows.find((r) => r.name === "volume#1")?.cells[0]?.at(-1)).toEqual({ text: "¹", tone: "secondary", note: true });
    // The notes of a cell, of a row: what the board shows on hover.
    const volume = board.rows.find((r) => r.name === "volume#1");
    expect(volume?.cellNotes[1]).toEqual([{ marker: "¹", level: "info", text: "system/vol/dns avail down", nodes: "all" }]);
    expect(volume?.rowNotes).toHaveLength(1);
    expect(board.rows.find((r) => r.name === "container#janitor")?.cellNotes).toEqual([[], []]);
    expect(instance?.cellNotes[1]).toEqual([
      { marker: "", level: "error", text: "start failed: the orchestration gave up, clear the instance to retry", nodes: "dev3n2" },
    ]);
    expect(instance?.rowNotes).toHaveLength(2);
    expect(board.rows.map((r) => r.kind)).toEqual([
      "instance", "monitor", "blank", "resources", "resource", "resource", "resource", "resource", "resource", "resource",
    ]);
  });

  test("a vol down: its downs red under a child up, gray with a note when its children are down", () => {
    const at = "2026-10-28T10:00:00Z";
    const vol = (child: string): ObjectData => ({
      avail: "down",
      overall: "down",
      provisioned: "true",
      topology: "flex",
      flex: { min: 0, max: 2, target: 0 },
      scope: ["n1"],
      instances: {
        n1: {
          status: { avail: "down", overall: "down", provisioned: "true", resources: { "fs#0": { status: "down", type: "fs.tmpfs" } } },
          monitor: { state: "idle", updated_at: at, children: { "system/svc/dns": child } },
        },
      },
    });
    const icons = (board: Board) => ["instance", "fs#0"].map((name) => board.rows.find((r) => r.name === name)?.cells[0]?.[0]?.tone);
    const used = buildBoard({ path: "system/vol/dns", object: vol("up") });
    expect(icons(used)).toEqual(["error", "error"]);
    expect(used.notes.map((g) => g.text)).not.toContain("children are down");
    // Why its down is an issue: the child up, named.
    expect(used.notes[0]).toMatchObject({ level: "error", text: "down while its child system/svc/dns is up: the child needs the vol" });
    // Several up, on their nodes: all named, once each.
    const two = vol("up");
    if (two.instances?.n1?.monitor) two.instances.n1.monitor.children = { "ns/svc/b@n1": "up", "ns/svc/a": "warn", "ns/svc/c": "down" };
    expect(buildBoard({ path: "system/vol/dns", object: two }).notes[0]?.text).toBe("down while its children ns/svc/a, ns/svc/b@n1 are up: they need the vol");
    const unused = buildBoard({ path: "system/vol/dns", object: vol("down") });
    expect(icons(unused)).toEqual(["secondary", "secondary"]);
    expect(unused.notes).toContainEqual(expect.objectContaining({ level: "info", text: "children are down" }));
    // No children, or none of them an object (undef): gray, said so.
    const childless = (children?: Record<string, string>): ObjectData => {
      const o = vol("down");
      const monitor = o.instances?.n1?.monitor ?? {};
      if (children === undefined) delete monitor.children;
      else monitor.children = children;
      return o;
    };
    for (const o of [childless(), childless({}), childless({ "ns/svc/gone": "undef" })]) {
      const board = buildBoard({ path: "system/vol/dns", object: o });
      expect(icons(board)).toEqual(["secondary", "secondary"]);
      expect(board.notes).toContainEqual(expect.objectContaining({ level: "info", text: "no children" }));
    }
    // One child gone, the other down: its children are down.
    const mixed = buildBoard({ path: "system/vol/dns", object: childless({ "ns/svc/gone": "undef", "ns/svc/s": "down" }) });
    expect(mixed.notes).toContainEqual(expect.objectContaining({ text: "children are down" }));
    // No monitor known: nothing said of its children, its downs red.
    const unmonitored = vol("down");
    delete unmonitored.instances?.n1?.monitor;
    expect(icons(buildBoard({ path: "system/vol/dns", object: unmonitored }))).toEqual(["error", "error"]);
  });

  test("a failover service with an unsupported driver reads as om shows it", () => {
    const board = buildBoard({ path: "foo001", object: foo001 as ObjectData });
    expect(toText(board)).toBe(`foo001   failover · ha · nodes order
  avail            n/a
  overall          n/a

                   dev3n1   dev3n2
  instance         /!       /!
    monitor        idle     idle
    expect         started  ·

  resources
    fs#1           / O ¹    / O ¹   ggzgrg  fs.ggzgrg

 notes
 ¹  warn  fs#1   all
       the fs.ggzgrg driver is not supported by this agent: the
       resource is ignored
`);
  });

  test("the states worth saying, the frozen nodes and the excess instances", () => {
    const object: ObjectData = {
      avail: "up",
      overall: "warn",
      frozen: "frozen",
      provisioned: "true",
      topology: "failover",
      orchestrate: "ha",
      placement_policy: "nodes order",
      placement_state: "non-optimal",
      up_instances_count: 2,
      scope: ["n1", "n2"],
      instances: {
        n1: {
          config: { resources: {} },
          monitor: { state: "idle", updated_at: "2026-10-12T10:00:00Z", is_leader: true },
          status: { avail: "up", overall: "warn", frozen_at: "2026-10-12T10:00:00Z", provisioned: "true" },
        },
        n2: {
          config: { resources: {} },
          monitor: { state: "idle", updated_at: "2026-10-12T10:00:00Z", is_ha_leader: true },
          status: { avail: "up", overall: "up", provisioned: "true" },
        },
      },
    };
    const board = buildBoard({ path: "ns1/svc/web", object, frozenNodes: new Set(["n2"]), isCompat: false });
    expect(plain(board.fields.find((f) => f.name === "state")?.value ?? [])).toBe(
      "frozen, non-optimal-placement, incompatible-versions",
    );
    expect(board.nodes).toEqual([
      { name: "n1", frozen: false },
      { name: "n2", frozen: true },
    ]);
    // Two up where failover allows one: the count in red, an error note.
    expect(board.rows[0]?.desc).toEqual([{ text: "2/1", tone: "error" }]);
    expect(board.rows[0]?.cells.map(plain)).toEqual(["O!*", "O^"]);
    const subjects = board.notes.flatMap((g) => g.heads.map((h) => `${g.level} ${h.subject} ${h.nodes}`.trim()));
    expect(subjects).toEqual([
      "error instances all",
      "error agents",
      "warn placement",
      "warn overall n1",
      "info frozen n1",
      "info node frozen n2",
    ]);
    expect(board.notes.find((g) => g.heads[0]?.subject === "placement")?.text).toBe(
      "non-optimal: the placement policy prefers n1",
    );
  });

  test("an overall warn no resource explains: the mix of states making it, node by node", () => {
    const instance = (resources: Record<string, { status: string }>) => ({
      config: { resources: {} },
      monitor: { state: "idle", updated_at: "2026-10-12T10:00:00Z" },
      status: { avail: "warn", overall: "warn", provisioned: "true", resources },
    });
    const object: ObjectData = {
      avail: "warn",
      overall: "warn",
      provisioned: "true",
      topology: "flex",
      orchestrate: "ha",
      scope: ["n1", "n2", "n3"],
      instances: {
        n1: instance({ "ip#0": { status: "down" }, "fs#1": { status: "up" }, "container#0": { status: "up" } }),
        n2: instance({ "ip#0": { status: "down" }, "fs#1": { status: "up" }, "container#0": { status: "up" } }),
        n3: instance({ "app#1": { status: "stdby up" }, "app#2": { status: "stdby down" }, "sync#1": { status: "down" }, "sync#2": { status: "up" } }),
      },
    };
    const board = buildBoard({ path: "ns1/svc/web", object });
    const overall = board.notes.filter((g) => g.heads[0]?.subject === "overall").map((g) => [g.heads[0]?.nodes, g.text]);
    expect(overall).toEqual([
      ["n1 n2", "mixed resource states: container#0 fs#1 up, ip#0 down"],
      ["n3", "mixed resource states: app#1 up, app#2 down, sync#1 down, the data not replicated"],
    ]);
  });

  test("a mix listed short, its resources past a few counted; none known, the mix alone", () => {
    const many = Object.fromEntries([...Array(8).keys()].map((i) => [`fs#${i}`, { status: "up" }]));
    expect(mixedStates({ resources: { ...many, "ip#0": { status: "down" } } })).toBe(
      "mixed resource states: fs#0 fs#1 fs#2 fs#3 fs#4 fs#5 +2 up, ip#0 down",
    );
    expect(mixedStates({ resources: { "container#1": { status: "up" } }, encap: { "container#1": { resources: { "app#1": { status: "down" } } } } })).toBe(
      "mixed resource states: container#1 up, app#1 down",
    );
    expect(mixedStates(undefined)).toBe("mixed resource states");
    // By their bytes, as the cli: "#" (0x23) before the digits and the letters, upper case before lower.
    expect(mixedStates({ resources: { fsa: { status: "up" }, "fs#1": { status: "up" }, fs1: { status: "up" }, FS: { status: "up" }, "ip#0": { status: "down" } } })).toBe(
      "mixed resource states: FS fs#1 fs1 fsa up, ip#0 down",
    );
  });

  test("a note offers the action it asks for, on its instances or on the object", () => {
    const fixOf = (board: Board, subject: string) => board.notes.find((g) => g.heads[0]?.subject === subject)?.fix;
    // Failed on both nodes: one note, its clear on both instances.
    expect(fixOf(buildBoard({ path: "system/svc/dns", object: dns as ObjectData }), "monitor")).toEqual({
      action: "clear",
      nodes: ["dev3n1", "dev3n2"],
    });
    const instance = (status: Record<string, string>) => ({
      config: { resources: {} },
      monitor: { state: "idle", updated_at: "2026-10-12T10:00:00Z" },
      status: { avail: "down", overall: "down", provisioned: "true", ...status },
    });
    const at = "2026-10-12T10:00:00Z";
    const object = (topology: string, avail: string): ObjectData => ({
      avail,
      overall: "down",
      topology,
      instances: {
        n1: instance({ frozen_at: at, stopped_at: at, provisioned: "false" }),
        n2: instance({ frozen_at: at, stopped_at: at, provisioned: "false" }),
        n3: instance({ stopped_at: at }),
      },
    });
    // Some instances: those; all of them: the object.
    const flex = buildBoard({ path: "ns1/svc/web", object: object("flex", "down") });
    expect(fixOf(flex, "frozen")).toEqual({ action: "unfreeze", nodes: ["n1", "n2"] });
    expect(fixOf(flex, "provisioned")).toEqual({ action: "provision", nodes: ["n1", "n2"] });
    expect(fixOf(flex, "stopped")).toEqual({ action: "start", nodes: [] });
    // A failover object starts by its orchestration, down; up, its stopped instances stay so.
    const failover = buildBoard({ path: "ns1/svc/web", object: object("failover", "down") });
    expect(fixOf(failover, "stopped")).toEqual({ action: "start", nodes: [] });
    expect(fixOf(buildBoard({ path: "ns1/svc/web", object: object("failover", "up") }), "stopped")).toBeUndefined();
    // Nothing to do about the others.
    expect(fixOf(flex, "monitor")).toBeUndefined();
  });

  test("resources run in order, by subset, the encapsulated ones under their container", () => {
    vi.useFakeTimers({ now: new Date("2026-10-12T12:00:00Z") });
    const res = (type: string, label: string, extra = {}) => ({ type, label, status: "up", ...extra });
    const object: ObjectData = {
      avail: "up",
      overall: "up",
      topology: "flex",
      flex: { min: 1, max: 2, target: 2 },
      up_instances_count: 2,
      scope: ["n1", "n2"],
      instances: Object.fromEntries(
        ["n1", "n2"].map((n) => [
          n,
          {
            config: { resources: { "app#a": { restart: 3 } }, subsets: { "subset#app:g": { parallel: true } } },
            monitor: { state: "idle", updated_at: "2026-10-12T10:00:00Z", resources: { "app#a": { restart: { remaining: 2 } } } },
            status: {
              avail: "up",
              running: n === "n1" ? [{ rid: "app#a" }] : [],
              resources: {
                "app#a": res("app.simple", "simple", { subset: "g", monitor: true }),
                "fs#1": res("fs.ext4", `/dev/sd${n === "n1" ? "a" : "b"}@/srv`, { rpo_breached_at: "2026-10-12T11:00:00Z" }),
                "ip#1": res("ip.host", "10.0.0.1"),
                "container#1": res("container.oci", "oci img"),
              },
              encap: { "container#1": { resources: { "app#in": res("app.forking", "forking") } } },
            },
          },
        ]),
      ),
    };
    const board = buildBoard({ path: "ns1/svc/web", object });
    const rows = board.rows.map((r) => `${"  ".repeat(r.indent)}${r.name}|${r.cells.map(plain).join("|")}|${r.typ}|${plain(r.desc)}`);
    expect(rows).toEqual([
      // A run in progress on n1: the R of om mon.
      "instance|OR|O||2/2",
      "  monitor|idle|idle||",
      "||||",
      "resources||||",
      "  ip#1|O|O|host|10.0.0.1",
      "  fs#1|O ¹|O ¹|ext4|/srv",
      "  ||||@n1 /dev/sda",
      "  ||||@n2 /dev/sdb",
      "  container#1|O|O|oci|img",
      "    app#in|O|O|forking|",
      "  subset#app:g||||//",
      "    app#a|O RM2|O M2|simple|",
    ]);
    expect(board.notes[0]?.text).toMatch(/^rpo breached since 2026-10-12T11:00:00Z/);
  });

  test("the notes of a resource on its nodes: grouped by text, errors first, the RPO breached too", () => {
    const notes = resourceNotes([
      ["n1", { log: [{ level: "info", message: "started" }, { level: "error", message: "exit 1" }] }],
      ["n2", { log: [{ level: "info", message: "started" }], rpo_breached_at: "1970-01-01T00:00:00Z" }],
    ]);
    expect(notes.map((n) => [n.level, n.nodes, n.text.split(":")[0]])).toEqual([
      ["error", "n1", "exit 1"],
      ["error", "n2", "rpo breached"],
      ["info", "all", "started"],
    ]);
    // On one node: no nodes said.
    expect(resourceNotes([["n1", { log: [{ level: "warn", message: "slow" }] }]])).toEqual([{ marker: "", level: "warn", text: "slow", nodes: "" }]);
    expect(resourceNotes([["n1", {}]])).toEqual([]);
  });

  test("labels split in what the nodes share and what they do not", () => {
    expect(words("/dev/sda@/srv ext4")).toEqual(["/dev/sda@", "/srv", "ext4"]);
    const split = splitLabels(["a", "b"], new Map([["a", "/dev/sda@/srv"], ["b", "/dev/sdb@/srv"]]));
    expect(split.common).toBe("/srv");
    expect(split.varying.get("a")).toBe("/dev/sda@");
  });

  test("markers stay one glyph up to the 28th note", () => {
    expect([1, 9, 10, 28, 29].map(marker)).toEqual(["¹", "⁹", "ᴬ", "ᵂ", "²⁹"]);
  });

  test("cells selected side by side make one block, edged on its outside only", () => {
    // A 2x2 block at the top left of a 3x3 grid.
    const at = (r: number, c: number) => r >= 0 && c >= 0 && r < 2 && c < 2;
    expect(selectionEdges(at, 0, 0)?.boxShadow).toBe("inset 1px 0 0 var(--accent), inset 0 1px 0 var(--accent)");
    expect(selectionEdges(at, 1, 1)?.boxShadow).toBe("inset -1px 0 0 var(--accent), inset 0 -1px 0 var(--accent)");
    expect(selectionEdges(at, 2, 2)).toBeUndefined();
    // Alone, a cell is edged all round.
    expect(selectionEdges((r, c) => r === 0 && c === 0, 0, 0)?.boxShadow?.split(", ")).toHaveLength(4);
  });
});
