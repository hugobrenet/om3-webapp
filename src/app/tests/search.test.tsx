import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { GlobalSearch } from "../GlobalSearch";
import { setHistoryGrouping } from "../panel-history";
import { reloadRecordHistory, useRecordHistory } from "../record-history";
import { LIMIT_ALL, hitIcon, search, type SearchIndex } from "../search";

const index: SearchIndex = {
  entries: [
    { kind: "object", id: "system/svc/dns", label: "system/svc/dns", context: ["svc"], status: "down" },
    { kind: "object", id: "foo001", label: "foo001", context: ["svc"], status: "n/a" },
    { kind: "object", id: "ns1/sec/dns-key", label: "ns1/sec/dns-key", context: ["sec"] },
    { kind: "namespace", id: "system", label: "system", context: [] },
    { kind: "node", id: "dev3n1", label: "dev3n1", context: ["v3.0.0"] },
    { kind: "network", id: "default", label: "default", context: ["bridge", "10.22.0.0/24"] },
  ],
  failed: [],
};

describe("search", () => {
  test("finds the text in the labels and the contexts, the ones starting with it first, by kind", () => {
    const groups = search(index, "dns", "all");
    expect(groups.map((g) => g.kind)).toEqual(["object"]);
    expect(groups[0]?.hits.map((h) => h.id)).toEqual(["ns1/sec/dns-key", "system/svc/dns"]);
    expect(search(index, "10.22", "all")[0]?.hits[0]?.id).toBe("default");
    expect(search(index, "SYSTEM", "all").map((g) => g.kind)).toEqual(["object", "namespace"]);
  });

  test("an empty query finds nothing, a scope narrows to one kind and shows more of it", () => {
    expect(search(index, "  ", "all")).toEqual([]);
    const many: SearchIndex = {
      entries: Array.from({ length: 12 }, (_, i) => ({ kind: "node" as const, id: `n${i}`, label: `n${i}`, context: [] })),
      failed: [],
    };
    expect(search(many, "n", "all")[0]).toMatchObject({ more: true });
    expect(search(many, "n", "all")[0]?.hits).toHaveLength(LIMIT_ALL);
    expect(search(many, "n", "node")[0]).toMatchObject({ more: false });
    expect(search(many, "n", "network")).toEqual([]);
  });

  test("a kind that could not be read says so", () => {
    expect(search({ entries: [], failed: ["network"] }, "x", "all")).toEqual([
      { kind: "network", hits: [], more: false, error: true },
    ]);
  });

  test("an object shows the icon of its kind", () => {
    expect(hitIcon(index.entries[2]!)).toBe("secret");
    expect(hitIcon(index.entries[1]!)).toBe("service");
  });
});

function Search() {
  return <output data-testid="location">{decodeURIComponent(useLocation().pathname + useLocation().search)}</output>;
}

function renderSearch(load = vi.fn(() => Promise.resolve(index)), at = "/objects?kind=svc") {
  render(
    <MemoryRouter initialEntries={[at]}>
      <GlobalSearch loadIndex={load} />
      <Search />
    </MemoryRouter>,
  );
  return load;
}

describe("GlobalSearch", () => {
  test("/ and Ctrl K open the palette, which reads the lists then", async () => {
    const load = renderSearch();
    expect(load).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(screen.getByRole("dialog", { name: "Search the cluster" })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("combobox", { name: "Search the cluster" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Search the cluster" })).toBeInTheDocument();
  });

  test("a result opens its record over the view, the arrows choosing it", async () => {
    renderSearch();
    fireEvent.click(screen.getByRole("button", { name: /Search the cluster/ }));
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "dns" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/objects?kind=svc&peek=object:system/svc/dns");
  });

  test("a node opens its panel, as the other records; n/a is written /", async () => {
    renderSearch();
    fireEvent.keyDown(document.body, { key: "/" });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "foo" } });
    const option = await screen.findByRole("option");
    expect(within(option).getByTitle("n/a").querySelector("svg")).toHaveAttribute("data-glyph", "na");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "dev3" } });
    await waitFor(() => expect(screen.getByRole("option")).toHaveTextContent("dev3n1"));
    expect(screen.getByRole("option")).not.toHaveTextContent("opens the list");
    fireEvent.click(screen.getByRole("option"));
    expect(screen.getByTestId("location")).toHaveTextContent("peek=node:dev3n1");
  });

  test("a scope narrows the search to one kind", async () => {
    renderSearch();
    fireEvent.keyDown(document.body, { key: "/" });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "system" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Namespaces" }));
    expect(screen.getByRole("button", { name: "Namespaces" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  test("says when the lists could not be read", async () => {
    renderSearch(vi.fn(() => Promise.reject(new Error("HTTP 500"))));
    fireEvent.keyDown(document.body, { key: "/" });
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 500");
  });

  test("/ typed in a field stays a character", () => {
    renderSearch();
    const field = document.createElement("input");
    document.body.appendChild(field);
    act(() => field.focus());
    fireEvent.keyDown(field, { key: "/" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    field.remove();
  });
});

describe("GlobalSearch, the records shown recently", () => {
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

  const open = () => {
    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    return screen.getByRole("combobox", { name: "Search the cluster" });
  };
  /** The options as listed: their names. */
  const names = () => screen.queryAllByRole("option").map((option) => option.querySelector(".font-medium")?.textContent);
  const active = () => screen.getAllByRole("option").find((option) => option.getAttribute("aria-selected") === "true");

  test("nothing typed, proposed the most recent first, each with its kind and when; the arrows and Enter open one", () => {
    show(["object", "ns1/sec/tls"], ["network", "lo"], ["object", "ns1/svc/web"]);
    renderSearch();
    const input = open();
    expect(screen.getByText("Recently opened")).toBeInTheDocument();
    expect(names()).toEqual(["ns1/svc/web", "lo", "ns1/sec/tls"]);
    const first = screen.getAllByRole("option")[0]!;
    expect(first).toHaveTextContent("Service");
    expect(first).toHaveTextContent(/now|ago|second/);
    expect(active()).toBe(first);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", active()!.id);
    expect(active()).toHaveTextContent("lo");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("peek=network:lo");
  });

  test("the active option alone highlighted, following the arrows, in the records as in the results", async () => {
    show(["object", "ns1/sec/tls"], ["network", "lo"]);
    renderSearch();
    const input = open();
    const highlighted = () => screen.getAllByRole("option").filter((option) => option.classList.contains("bg-accent-soft"));
    expect(highlighted().map((o) => o.textContent)).toEqual([expect.stringContaining("lo")]);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(highlighted()).toEqual([active()]);
    expect(active()).toHaveTextContent("ns1/sec/tls");
    fireEvent.change(input, { target: { value: "dns" } });
    await waitFor(() => expect(names()).toEqual(["ns1/sec/dns-key", "system/svc/dns"]));
    expect(highlighted()).toEqual([active()]);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(highlighted()).toEqual([active()]);
    expect(active()).toHaveTextContent("system/svc/dns");
  });

  test("typed, the search; emptied, the records again", async () => {
    show(["object", "ns1/svc/web"]);
    renderSearch();
    const input = open();
    fireEvent.change(input, { target: { value: "dns" } });
    expect(screen.queryByText("Recently opened")).not.toBeInTheDocument();
    await waitFor(() => expect(names()).toEqual(["ns1/sec/dns-key", "system/svc/dns"]));
    fireEvent.change(input, { target: { value: "" } });
    expect(names()).toEqual(["ns1/svc/web"]);
  });

  test("Delete, or the cross, removes one; the bin clears them all, the hint back", () => {
    show(["object", "ns1/sec/tls"], ["network", "lo"], ["object", "ns1/svc/web"]);
    renderSearch();
    const input = open();
    fireEvent.keyDown(input, { key: "Delete" });
    expect(names()).toEqual(["lo", "ns1/sec/tls"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove ns1/sec/tls from the history" }));
    expect(names()).toEqual(["lo"]);
    // Still open, the focus back in the field.
    expect(input).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(names()).toEqual([]);
    expect(screen.getByText(/Type a name/)).toBeInTheDocument();
  });

  test("grouped by kind, the om3 kinds in order; the choice remembered in this browser", () => {
    show(["object", "ns1/sec/tls"], ["object", "ns1/svc/web"], ["network", "lo"], ["object", "ns1/svc/db"]);
    renderSearch();
    open();
    fireEvent.click(screen.getByRole("button", { name: "By kind" }));
    const groups = screen.getAllByRole("group").filter((group) => group.querySelector("[role=option]"));
    expect(groups.map((group) => group.getAttribute("aria-labelledby") && document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent)).toEqual([
      "Services",
      "Secrets",
      "Networks",
    ]);
    expect(names()).toEqual(["ns1/svc/db", "ns1/svc/web", "ns1/sec/tls", "lo"]);
    expect(localStorage.getItem("om3.panelHistory.grouping")).toBe("kind");
  });

  test("a scope keeps the records of its kind; the one on display is said open", () => {
    show(["object", "ns1/svc/web"], ["network", "lo"]);
    renderSearch(undefined, "/objects?peek=object:ns1/svc/web");
    open();
    expect(screen.getAllByRole("option")[1]).toHaveTextContent("open");
    fireEvent.click(screen.getByRole("button", { name: "Networks" }));
    expect(names()).toEqual(["lo"]);
    fireEvent.click(screen.getByRole("button", { name: "Nodes" }));
    expect(names()).toEqual([]);
    expect(screen.getByText("Nothing of this kind opened recently.")).toBeInTheDocument();
  });
});
