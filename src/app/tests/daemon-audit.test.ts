import { describe, expect, test } from "vitest";
import { auditRecordOf, auditText, auditUrl, eventStreamParser, parseSubsystems, subsystemSuggestions } from "../daemon-audit";

describe("daemon audit", () => {
  test("the subsystems of a field: by blanks or commas, once each, none for all", () => {
    expect(parseSubsystems("")).toEqual([]);
    expect(parseSubsystems("  scheduler, imon:*  scheduler\nhb:1")).toEqual(["scheduler", "imon:*", "hb:1"]);
  });

  test("the suggestions: the known names containing what is typed, a suffixed one to complete, then the objects", () => {
    expect(subsystemSuggestions("hb", [], [])).toEqual([
      { value: "hb", partial: false },
      { value: "hb.ctrl", partial: false },
      { value: "hb.main", partial: false },
      { value: "hb.peer_dropper", partial: false },
      { value: "hb:", partial: true },
    ]);
    // The ones chosen apart.
    expect(subsystemSuggestions("sched", ["scheduler"], [])).toEqual([]);
    expect(subsystemSuggestions("imon:web", [], ["prod/svc/web", "prod/svc/db", "test/svc/web"]).map((s) => s.value)).toEqual([
      "imon:*",
      "imon:prod/svc/web",
      "imon:test/svc/web",
    ]);
    // A heartbeat id is not an object: nothing to suggest past "hb:".
    expect(subsystemSuggestions("hb:1", [], ["prod/svc/web"])).toEqual([]);
  });

  test("the address: the level, a sub a subsystem, none for all, preempt on demand", () => {
    expect(auditUrl("/api/node/name", "n1", { level: "debug", subsystems: [] })).toBe(
      "/api/node/name/n1/daemon/audit?level=debug",
    );
    expect(auditUrl("/api/node/name", "n1", { level: "trace", subsystems: ["imon:*", "hb:1"], preempt: true })).toBe(
      "/api/node/name/n1/daemon/audit?level=trace&sub=imon%3A*&sub=hb%3A1&preempt=true",
    );
  });

  test("the events of a stream, as the daemon writes them, whatever the chunks", () => {
    const parse = eventStreamParser();
    const stream =
      'id:0\ndata:{"level":"info","message":"n1: daemon audit: audit started"}\n\n\n' +
      "id:1\nevent:preempted\ndata: {\"level\":\"warn\"}\n\n";
    const events = [];
    // Cut anywhere: a line, a field, the blank line ending an event.
    for (let i = 0; i < stream.length; i += 7) events.push(...parse(stream.slice(i, i + 7)));
    expect(events).toEqual([
      { event: "", data: '{"level":"info","message":"n1: daemon audit: audit started"}' },
      { event: "preempted", data: '{"level":"warn"}' },
    ]);
  });

  test("a record: the node it starts with dropped, its prefixes apart; not JSON, none", () => {
    const record = auditRecordOf(
      '{"level":"debug","message":"n1: daemon: imon: prod/svc/web: start auditing","time":"2026-11-16T13:19:09.841+01:00"}',
      "n1",
      3,
    );
    expect(record).toMatchObject({
      id: 3,
      level: "debug",
      message: "daemon: imon: prod/svc/web: start auditing",
      prefixes: ["daemon", "imon", "prod/svc/web"],
      text: "start auditing",
    });
    expect(record?.time.toISOString()).toBe("2026-11-16T12:19:09.841Z");
    expect(auditRecordOf("not json", "n1", 0)).toBeNull();
    expect(auditText(record ? [record] : [])).toBe(
      "2026-11-16T12:19:09.841Z DEBUG daemon: imon: prod/svc/web: start auditing\n",
    );
  });
});
