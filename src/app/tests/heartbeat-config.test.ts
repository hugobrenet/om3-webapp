import { describe, expect, test } from "vitest";
import { hbOps, hbPreview, hbSections, isFieldOf, missingFields, nextHbName, sectionValues } from "../heartbeat-config";

const FILE = `[cluster]
name = dev2

[hb#1]
type = unicast
# the addresses of the nodes
addr@n1 = 10.0.0.1
addr@n2 = 10.0.0.2
port = 10011

[hb#3]
type = disk
dev = /dev/mapper/hb

[hb#relay]
type = relay
`;

describe("heartbeat config", () => {
  test("the keys of a section, scoped ones too, its comments left out", () => {
    expect(sectionValues("[hb#1]\ntype = unicast\n# a comment\naddr@n1 = 10.0.0.1\nport=10011\n")).toEqual({
      type: "unicast",
      "addr@n1": "10.0.0.1",
      port: "10011",
    });
    expect(sectionValues(null)).toEqual({});
  });

  test("the heartbeats of a file; the name of a new one, above the highest numbered", () => {
    expect(hbSections(FILE)).toEqual(["hb#1", "hb#3", "hb#relay"]);
    expect(nextHbName(hbSections(FILE))).toBe("hb#4");
    expect(nextHbName([])).toBe("hb#1");
  });

  test("the fields of a driver; those required left empty", () => {
    expect(isFieldOf("unicast", "addr@n1")).toBe(true);
    expect(isFieldOf("unicast", "dev")).toBe(false);
    expect(isFieldOf("disk", "timeout")).toBe(true);
    expect(missingFields("disk", { type: "disk", dev: " " })).toEqual(["dev"]);
    expect(missingFields("relay", { type: "relay", relay: "https://relay:1215" })).toEqual([]);
  });

  test("the same driver: the keys changed set, those emptied unset, the others left alone", () => {
    const original = sectionValues("[hb#1]\ntype = unicast\naddr@n1 = 10.0.0.1\naddr@n2 = 10.0.0.2\nport = 10011\n");
    const values = { ...original, "addr@n2": "10.0.0.20", port: "", timeout: "20s" };
    expect(hbOps("hb#1", original, values)).toEqual({
      rewrite: false,
      set: ["hb#1.addr@n2=10.0.0.20", "hb#1.timeout=20s"],
      unset: ["hb#1.port"],
    });
    // Nothing changed: nothing to write.
    expect(hbOps("hb#1", original, original)).toEqual({ rewrite: false, set: [], unset: [] });
  });

  test("a new heartbeat: its type first, then its keys", () => {
    expect(hbOps("hb#4", {}, { port: "10012", type: "multicast", addr: "" })).toEqual({
      rewrite: false,
      set: ["hb#4.type=multicast", "hb#4.port=10012"],
      unset: [],
    });
  });

  test("another driver: the section rewritten, the keys of the former dropped", () => {
    const original = sectionValues("[hb#1]\ntype = unicast\naddr@n1 = 10.0.0.1\nport = 10011\ntimeout = 20s\n");
    const values = { ...original, type: "disk", dev: "/dev/mapper/hb" };
    expect(hbOps("hb#1", original, values)).toEqual({
      rewrite: true,
      set: ["hb#1.type=disk", "hb#1.timeout=20s", "hb#1.dev=/dev/mapper/hb"],
      unset: [],
    });
    expect(hbPreview("hb#1", original, values)).toBe("[hb#1]\ntype = disk\ndev = /dev/mapper/hb\ntimeout = 20s");
  });

  test("the section as it will read: the type first, the keys set after", () => {
    expect(hbPreview("hb#4", {}, { port: "10012", type: "unicast", "addr@n1": "10.0.0.1", intf: "" })).toBe(
      "[hb#4]\ntype = unicast\naddr@n1 = 10.0.0.1\nport = 10012",
    );
  });
});
