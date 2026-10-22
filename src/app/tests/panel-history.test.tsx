import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { setHistoryGrouping, typeOf, usePanelHistory } from "../panel-history";
import { reloadRecordHistory, useRecordHistory } from "../record-history";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  reloadRecordHistory();
  setHistoryGrouping("time");
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

/** Records shown, the last one the most recent. */
function show(...steps: [string, string][]) {
  const { result } = renderHook(() => useRecordHistory());
  steps.forEach(([kind, id]) => {
    act(() => {
      result.current.record(kind, id);
    });
  });
}

describe("typeOf", () => {
  test.each([
    [{ kind: "object", id: "ns1/svc/web" }, "svc"],
    [{ kind: "object", id: "web" }, "svc"],
    [{ kind: "object", id: "vol/data" }, "vol"],
    [{ kind: "object", id: "ns1/sec/tls" }, "sec"],
    [{ kind: "object", id: "cluster" }, "ccfg"],
    [{ kind: "node", id: "dev3n1" }, "node"],
    [{ kind: "network", id: "lo" }, "network"],
    [{ kind: "namespace", id: "ns1" }, "namespace"],
  ])("%j is %s", (step, type) => {
    expect(typeOf(step)).toBe(type);
  });
});

describe("usePanelHistory", () => {
  const names = (groups: { key: string; entries: { label: string }[] }[]) =>
    groups.map((group) => [group.key, group.entries.map((entry) => entry.label)]);

  test("by time, the most recent first; by kind, the om3 kinds in order, the most recent first in each; the one on display said so", () => {
    show(["object", "ns1/sec/tls"], ["object", "ns1/svc/web"], ["network", "lo"], ["object", "ns1/svc/db"]);
    const byTime = renderHook(() => usePanelHistory("network:lo"));
    expect(names(byTime.result.current.groups)).toEqual([["time-now", ["ns1/svc/db", "lo", "ns1/svc/web", "ns1/sec/tls"]]]);
    expect(byTime.result.current.entries.filter((entry) => entry.current).map((entry) => entry.label)).toEqual(["lo"]);
    const byKind = renderHook(() => usePanelHistory("", "kind"));
    expect(names(byKind.result.current.groups)).toEqual([
      ["kind-svc", ["ns1/svc/db", "ns1/svc/web"]],
      ["kind-sec", ["ns1/sec/tls"]],
      ["kind-network", ["lo"]],
    ]);
  });

  test("removes one, clears them all", () => {
    show(["object", "ns1/svc/web"], ["network", "lo"]);
    const { result } = renderHook(() => usePanelHistory(""));
    act(() => {
      result.current.remove(result.current.entries[0]!);
    });
    expect(result.current.entries.map((entry) => entry.label)).toEqual(["ns1/svc/web"]);
    act(() => {
      result.current.clear();
    });
    expect(result.current.entries).toEqual([]);
  });
});
