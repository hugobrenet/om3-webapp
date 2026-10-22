import { afterEach, describe, expect, test, vi } from "vitest";
import { buildBoard, marker, splitLabels, words, type Board, type ObjectData, type Text } from "../statusboard";
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
