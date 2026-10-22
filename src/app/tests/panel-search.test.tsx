import { describe, expect, test } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { applyPanelUpdate, usePanelSearch, usePeek } from "../panel-search";

const params = (query: string) => new URLSearchParams(query);

describe("applyPanelUpdate", () => {
  test("a view within the tab kept while it changes alone; another tab, record or panel drops it", () => {
    expect(applyPanelUpdate(params("peek=node:n1&peektab=daemon"), { view: "dns" }).get("view")).toBe("dns");
    expect(applyPanelUpdate(params("peek=node:n1&peektab=daemon&view=dns"), { peektab: "logs" }).get("view")).toBeNull();
    expect(applyPanelUpdate(params("peek=node:n1&peektab=daemon&view=dns"), { peek: "node:n2" }).get("view")).toBeNull();
    expect(applyPanelUpdate(params("sel=n1&tab=daemon&view=dns"), { sel: "n2" }).get("view")).toBeNull();
    expect(applyPanelUpdate(params("peek=node:n1&view=dns"), { view: undefined }).get("view")).toBeNull();
  });

  test("opening a row panel keeps the filters of the view and starts on its first tab", () => {
    const next = applyPanelUpdate(params("namespace=ns1&tab=logs"), { sel: "ns1/svc/web" });
    expect(next.get("namespace")).toBe("ns1");
    expect(next.get("sel")).toBe("ns1/svc/web");
    expect(next.has("tab")).toBe(false);
  });

  test("one drawer at a time: the row panel closes the record looked at", () => {
    const next = applyPanelUpdate(params("peek=network:lo&peektab=x"), { sel: "a" });
    expect(next.has("peek")).toBe(false);
    expect(next.has("peektab")).toBe(false);
  });

  test("one drawer at a time: a record looked at closes the row panel", () => {
    const next = applyPanelUpdate(params("sel=a&tab=logs&kind=svc"), { peek: "network:lo" });
    expect(next.has("sel")).toBe(false);
    expect(next.has("tab")).toBe(false);
    expect(next.get("peek")).toBe("network:lo");
    expect(next.get("kind")).toBe("svc");
  });

  test("a tab given with the panel is kept, an empty value clears its key", () => {
    expect(applyPanelUpdate(params(""), { sel: "a", tab: "logs" }).get("tab")).toBe("logs");
    expect(applyPanelUpdate(params("sel=a&tab=logs"), { tab: "" }).has("tab")).toBe(false);
    expect(applyPanelUpdate(params("sel=a&tab=logs"), { tab: "x" }).get("sel")).toBe("a");
  });
});

function wrapper(initial: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  );
}

describe("usePanelSearch", () => {
  test("reads the panel state of the URL", () => {
    const { result } = renderHook(() => usePanelSearch(), {
      wrapper: wrapper("/objects?peek=object:ns1/svc/web&peektab=logs"),
    });
    expect(result.current.sel).toBeUndefined();
    expect(result.current.peek).toEqual({ kind: "object", id: "ns1/svc/web" });
    expect(result.current.peektab).toBe("logs");
  });

  test("the row panel wins over a record looked at, and an unknown record is none", () => {
    const both = renderHook(() => usePanelSearch(), {
      wrapper: wrapper("/objects?sel=a&peek=object:b"),
    });
    expect(both.result.current.peek).toBeNull();
    const unknown = renderHook(() => usePanelSearch(), { wrapper: wrapper("/objects?peek=disk:x") });
    expect(unknown.result.current.peek).toBeNull();
  });

  test("changes the URL of the view it is on, and the panel it names", () => {
    const { result } = renderHook(() => ({ panel: usePanelSearch(), location: useLocation(), peek: usePeek() }), {
      wrapper: wrapper("/network?x=1"),
    });
    act(() => result.current.panel.select("lo", "addresses"));
    expect(result.current.location.pathname).toBe("/network");
    expect(result.current.panel.sel).toBe("lo");
    expect(result.current.panel.tab).toBe("addresses");
    act(() => result.current.peek("object", "ns1/svc/web", "logs"));
    expect(result.current.panel.sel).toBeUndefined();
    expect(result.current.panel.peek).toEqual({ kind: "object", id: "ns1/svc/web" });
    expect(result.current.panel.peektab).toBe("logs");
    act(() => result.current.panel.closePeek());
    expect(result.current.location.search).toBe("?x=1");
  });
});
