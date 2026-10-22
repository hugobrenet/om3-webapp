import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  currentUser,
  HISTORY_SIZE,
  readLastRecord,
  reloadRecordHistory,
  rememberLastRecord,
  useRecordHistory,
} from "../record-history";
import { sectionOf } from "../panel-history";

/** An access token carrying these claims; the signature is not read. */
function token(claims: Record<string, unknown>): string {
  return `h.${btoa(JSON.stringify(claims)).replace(/=+$/, "")}.s`;
}

beforeEach(() => {
  localStorage.setItem("authToken", token({ sub: "alice" }));
  sessionStorage.clear();
  reloadRecordHistory();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  sessionStorage.clear();
});

describe("record history", () => {
  test("the user is the name the token gives, else its subject", () => {
    expect(currentUser()).toBe("alice");
    localStorage.setItem("authToken", token({ sub: "x", preferred_username: "bob" }));
    expect(currentUser()).toBe("bob");
    localStorage.setItem("authToken", "garbage");
    expect(currentUser()).toBe("");
  });

  test("a record shown comes in front, and a record removed leaves", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRecordHistory());
    act(() => result.current.record("object", "a"));
    vi.advanceTimersByTime(2 * 60 * 1000);
    act(() => result.current.record("network", "lo"));
    vi.advanceTimersByTime(2 * 60 * 1000);
    act(() => result.current.record("object", "a"));
    expect(result.current.entries.map((e) => e.id)).toEqual(["a", "lo"]);
    act(() => result.current.remove("object", "a"));
    expect(result.current.entries.map((e) => e.id)).toEqual(["lo"]);
    act(() => result.current.clear());
    expect(result.current.entries).toEqual([]);
  });

  test("a record picked in the history keeps its place", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRecordHistory());
    act(() => result.current.record("object", "a"));
    vi.advanceTimersByTime(2 * 60 * 1000);
    act(() => result.current.record("object", "b"));
    vi.advanceTimersByTime(2 * 60 * 1000);
    act(() => result.current.record("object", "a", false));
    expect(result.current.entries.map((e) => e.id)).toEqual(["b", "a"]);
  });

  test("it holds a bounded number of records, and is kept by the tab", () => {
    const { result } = renderHook(() => useRecordHistory());
    for (let i = 0; i < HISTORY_SIZE + 5; i++) act(() => result.current.record("object", `o${i}`));
    expect(result.current.entries).toHaveLength(HISTORY_SIZE);
    reloadRecordHistory();
    expect(renderHook(() => useRecordHistory()).result.current.entries).toHaveLength(HISTORY_SIZE);
  });

  test("someone else signing in starts from an empty history", () => {
    const { result } = renderHook(() => useRecordHistory());
    act(() => result.current.record("object", "a"));
    localStorage.setItem("authToken", token({ sub: "mallory" }));
    expect(renderHook(() => useRecordHistory()).result.current.entries).toEqual([]);
  });

  test("the last record is remembered apart", () => {
    expect(readLastRecord()).toBeNull();
    rememberLastRecord({ kind: "network", id: "lo" });
    expect(readLastRecord()).toEqual({ kind: "network", id: "lo" });
  });

  test("records are grouped by how long ago they were shown", () => {
    expect(sectionOf(0)).toBe("now");
    expect(sectionOf(10 * 60 * 1000)).toBe("hour");
    expect(sectionOf(3 * 60 * 60 * 1000)).toBe("day");
    expect(sectionOf(3 * 24 * 60 * 60 * 1000)).toBe("week");
  });
});
