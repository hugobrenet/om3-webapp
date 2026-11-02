import { describe, expect, test } from "vitest";
import { cachedReason, objectReason, type ObjectEvents } from "../object-reason";
import dns from "./fixtures/system-svc-dns.json";

/** What the stream holds of an object, from its data as the api reads it. */
function eventsOf(data: Record<string, unknown>): ObjectEvents {
  const { instances = {}, ...object } = data as { instances?: Record<string, Record<string, Record<string, unknown>>> };
  const by = (key: string) => Object.fromEntries(Object.entries(instances).map(([node, i]) => [node, i[key]]));
  return { object, instances: by("status"), monitors: by("monitor"), configs: by("config") };
}

describe("why an object is not up", () => {
  test("its first note, errors first, as its status board says it", () => {
    expect(objectReason("system/svc/dns", eventsOf(dns))).toEqual({
      level: "error",
      text: "start failed: the orchestration gave up, clear the instance to retry",
      more: 0,
      // The action its note asks for: the clear of both its instances.
      fix: { action: "clear", nodes: ["dev3n1", "dev3n2"] },
    });
  });

  test("an object up, or of no status: none", () => {
    expect(objectReason("system/svc/dns", { ...eventsOf(dns), object: { ...eventsOf(dns).object, avail: "up", overall: "up" } })).toBeNull();
    expect(objectReason("system/cfg/c", { object: undefined, instances: undefined, monitors: {}, configs: undefined })).toBeNull();
  });

  test("no note: its resources down, three at most, not the optional ones", () => {
    const status = (resources: Record<string, unknown>) => ({ avail: "down", overall: "down", resources });
    const events: ObjectEvents = {
      object: { avail: "down", overall: "down", topology: "failover", orchestrate: "no" },
      instances: {
        n1: status({ "container#1": { status: "down" }, "fs#1": { status: "down", optional: true }, "app#1": { status: "up" } }),
        n2: status({ "container#1": { status: "down" }, "container#2": { status: "down" } }),
      },
      monitors: {},
      configs: undefined,
    };
    // Monitors never updated: a note says so, before the resources.
    expect(objectReason("root/svc/encap", events)?.text).toMatch(/^no instance monitor/);
    const monitored = { ...events, monitors: { n1: { state: "idle", updated_at: "2026-10-28T10:00:00Z" }, n2: { state: "idle", updated_at: "2026-10-28T10:00:00Z" } } };
    expect(objectReason("root/svc/encap", monitored)).toEqual({ level: "error", text: "container#1, container#2 down", more: 0 });
    const many = {
      ...monitored,
      instances: { n1: status(Object.fromEntries(["a#1", "b#1", "c#1", "d#1"].map((rid) => [rid, { status: "down" }]))) },
    };
    expect(objectReason("root/svc/many", many)?.text).toBe("a#1, b#1, c#1… down");
  });

  test("a vol down: an error under a child up, an info when its children are down too", () => {
    const at = "2026-10-28T10:00:00Z";
    const events = (child: string): ObjectEvents => ({
      object: { avail: "down", overall: "down", topology: "flex", flex: { min: 0, max: 2, target: 0 } },
      instances: {
        n1: { avail: "down", overall: "down", provisioned: "true", resources: { "fs#0": { status: "down" } } },
        n2: { avail: "down", overall: "down", provisioned: "true", resources: { "fs#0": { status: "down" } } },
      },
      monitors: {
        n1: { state: "idle", updated_at: at, children: { "system/svc/dns": child } },
        n2: { state: "idle", updated_at: at, children: { "system/svc/dns": child } },
      },
      configs: undefined,
    });
    expect(objectReason("system/vol/dns", events("up"))).toEqual({ level: "error", text: "fs#0 down", more: 0 });
    expect(objectReason("system/vol/dns", events("down"))).toEqual({ level: "info", text: "children are down", more: 0 });
    // Its child no object: no children, gray too.
    expect(objectReason("system/vol/dns", events("undef"))).toEqual({ level: "info", text: "no children", more: 0 });
    // Not a vol: its resources down, whatever its children.
    expect(objectReason("system/svc/dns", events("down"))?.level).toBe("error");
  });

  test("an object up, partly provisioned: an error", () => {
    const at = "2026-10-28T10:00:00Z";
    const events: ObjectEvents = {
      object: { avail: "up", overall: "up", provisioned: "mixed", topology: "failover" },
      instances: {
        n1: { avail: "up", overall: "up", provisioned: "true" },
        n2: { avail: "down", overall: "down", provisioned: "false" },
      },
      monitors: { n1: { state: "idle", updated_at: at }, n2: { state: "idle", updated_at: at } },
      configs: { n1: { resources: {} }, n2: { resources: {} } },
    };
    expect(objectReason("root/svc/foo003", events)).toMatchObject({
      level: "error",
      text: "the instance is not provisioned, or partly",
      fix: { action: "provision", nodes: ["n2"] },
    });
  });

  test("infos only: stopped on purpose first, then the resources down, then a freeze, said so", () => {
    const at = "2026-10-28T10:00:00Z";
    const events = (resources: Record<string, unknown>, stopped: boolean): ObjectEvents => ({
      object: { avail: "down", overall: "down", topology: "failover", orchestrate: "ha" },
      instances: { n1: { avail: "down", overall: "down", frozen_at: at, resources, ...(stopped ? { stopped_at: at } : {}) } },
      monitors: { n1: { state: "idle", updated_at: at } },
      configs: undefined,
    });
    expect(objectReason("root/svc/s", events({ "fs#1": { status: "down" } }, true))).toMatchObject({
      text: expect.stringMatching(/^stopped on purpose/),
      // A failover object down, started by its orchestration.
      fix: { action: "start", nodes: [] },
    });
    expect(objectReason("root/svc/s", events({ "fs#1": { status: "down" } }, false))?.text).toBe("fs#1 down");
    expect(objectReason("root/svc/s", events({}, false))).toEqual({
      level: "info",
      text: "frozen: the daemon takes no initiative on the instance",
      more: 0,
      fix: { action: "unfreeze", nodes: ["n1"] },
    });
  });

  test("kept while what it is read from does not change", () => {
    const events = eventsOf(dns);
    const first = cachedReason("system/svc/dns", events);
    expect(cachedReason("system/svc/dns", { ...events })).toBe(first);
    expect(cachedReason("system/svc/dns", { ...events, object: { ...events.object } })).not.toBe(first);
  });
});
