import { afterEach, describe, expect, test } from "vitest";
import { forceLifts, readProblem, withWriteParams } from "../config-write";
import { trackWrite, useActionTracker } from "../action-tracker";
import { clearConfigStamps, configStamp } from "../config-stamps";

const problem = (status: number, body: { title?: string; detail?: string }, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe("what force lifts of a refusal", () => {
  test("root writes past a change a resource up would leak by, and a value held by another object", () => {
    expect(forceLifts({ status: 403, title: "Forbidden", detail: "fs#1: mnt is held up on n1: stop it first" })).toBe("root");
    expect(forceLifts({ status: 409, title: "Held by another object", detail: "fs#1: mnt /srv on n1 is held by ns1/svc/db fs#2" })).toBe(
      "root",
    );
  });

  test("anyone replaces an object that exists, by a creation forced", () => {
    expect(forceLifts({ status: 409, title: "Conflict", detail: "Use the PUT method" }, { creating: true })).toBe("anyone");
    expect(forceLifts({ status: 409, title: "Conflict", detail: "Use the PUT method" })).toBeNull();
  });

  test("nothing of a configuration invalid, changed meanwhile, or a grant missing", () => {
    expect(forceLifts({ status: 403, detail: "Config validation: bad keyword" })).toBeNull();
    expect(forceLifts({ status: 403, detail: "force requires the root grant" })).toBeNull();
    expect(forceLifts({ status: 409, title: "Update config", detail: "changed meanwhile" })).toBeNull();
    expect(forceLifts({ status: 400, detail: "bad" })).toBeNull();
    expect(forceLifts({ status: 403 })).toBeNull();
  });

  test("read from the answer, which is left to read again", async () => {
    const response = problem(409, { title: "Held by another object", detail: "held" });
    expect(await readProblem(response)).toEqual({ status: 409, title: "Held by another object", detail: "held" });
    expect(await response.json()).toEqual({ title: "Held by another object", detail: "held" });
    expect(await readProblem(new Response("not json", { status: 500 }))).toEqual({ status: 500 });
  });
});

describe("the parameters of a write", () => {
  test("appended to the ones of the address", () => {
    // The wait always: no write answered before the configuration reaches the nodes.
    expect(withWriteParams("/c/config/file")).toBe("/c/config/file?wait=30s");
    expect(withWriteParams("/c/config?set=a%3Db", { force: true })).toBe("/c/config?set=a%3Db&wait=30s&force=true");
  });
});

describe("a wait for the nodes that expired", () => {
  afterEach(() => {
    clearConfigStamps();
    useActionTracker.setState({ tracked: [] });
  });

  test("is a write done, the nodes not reached said beside it, its time kept", async () => {
    const response = problem(
      408,
      { detail: "the configuration of ns1/svc/web is committed as of T, and has not reached n2 before the wait expired" },
      { "OM-Last-Modified": "2026-10-23T10:00:00Z" },
    );
    const info = { action: "config", subject: "ns1/svc/web", label: "Update the configuration", path: "ns1/svc/web" };
    expect(await trackWrite(response, info, async () => "refused")).toBe(true);
    const [entry] = useActionTracker.getState().tracked;
    expect(entry?.state).toBe("succeeded");
    expect(entry?.error).toContain("has not reached n2");
    expect(configStamp("ns1/svc/web")).toBe("2026-10-23T10:00:00Z");
  });
});
