import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import "../../i18n";
import { DEFAULT_LIMIT, useLocalPaging, usePaging } from "../paging";
import { Pager } from "../../ui/components/Pager";

let location: ReturnType<typeof useLocation>;
function LocationSpy() {
  location = useLocation();
  return null;
}

const wrapperAt =
  (entry: string) =>
  ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[entry]}>
      {children}
      <LocationSpy />
    </MemoryRouter>
  );

const rows = (n: number) => Array.from({ length: n }, (_, i) => i);

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("usePaging", () => {
  test("50 rows a page by default, from the first", () => {
    const { result } = renderHook(() => usePaging("test", 120), { wrapper: wrapperAt("/list") });
    expect(result.current.limit).toBe(DEFAULT_LIMIT);
    expect(result.current.offset).toBe(0);
    expect(result.current.page(rows(120))).toEqual(rows(50));
  });

  test("the page of the URL, its size too", () => {
    const { result } = renderHook(() => usePaging("test", 120), { wrapper: wrapperAt("/list?limit=25&offset=50") });
    expect(result.current.limit).toBe(25);
    expect(result.current.page(rows(120))).toEqual(rows(75).slice(50));
  });

  test("a size the lists do not offer is ignored", () => {
    const { result } = renderHook(() => usePaging("test", 120), { wrapper: wrapperAt("/list?limit=7") });
    expect(result.current.limit).toBe(DEFAULT_LIMIT);
  });

  test("an offset past the end shows the last page; one between two pages, the page holding it", () => {
    const past = renderHook(() => usePaging("test", 120), { wrapper: wrapperAt("/list?offset=500") });
    expect(past.result.current.offset).toBe(100);
    const between = renderHook(() => usePaging("test", 120), { wrapper: wrapperAt("/list?offset=60") });
    expect(between.result.current.offset).toBe(50);
  });

  test("another size goes back to the first page, and is kept for the view", () => {
    const { result } = renderHook(() => usePaging("test", 120), { wrapper: wrapperAt("/list?offset=50") });
    act(() => result.current.setLimit(100));
    expect(location.search).toBe("?limit=100");
    expect(result.current.offset).toBe(0);
    expect(localStorage.getItem("om3.pageSize.test")).toBe("100");

    // The next time, without a size in the URL, the view opens with it; another view does not.
    expect(renderHook(() => usePaging("test", 120), { wrapper: wrapperAt("/list") }).result.current.limit).toBe(100);
    expect(renderHook(() => usePaging("other", 120), { wrapper: wrapperAt("/list") }).result.current.limit).toBe(50);
  });

  test("the first page leaves no offset in the URL, the others keep the filters", () => {
    const { result } = renderHook(() => usePaging("test", 120), { wrapper: wrapperAt("/list?name=web") });
    act(() => result.current.setOffset(50));
    expect(location.search).toBe("?name=web&offset=50");
    act(() => result.current.setOffset(0));
    expect(location.search).toBe("?name=web");
  });
});

function PagerOf({ total }: { total: number }) {
  return <Pager paging={usePaging("test", total)} />;
}

describe("useLocalPaging", () => {
  test("held by the panel, not the URL: the page and the size its own, the size kept for its view", () => {
    const { result } = renderHook(({ total }) => useLocalPaging("test-local", total), {
      initialProps: { total: 120 },
    });
    expect(result.current.offset).toBe(0);
    expect(result.current.limit).toBe(DEFAULT_LIMIT);
    act(() => result.current.setOffset(100));
    expect(result.current.offset).toBe(100);
    expect(result.current.page(Array.from({ length: 120 }, (_, i) => i))).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119]);
    act(() => result.current.setLimit(25));
    expect(result.current.offset).toBe(0);
    expect(localStorage.getItem("om3.pageSize.test-local")).toBe("25");
  });
});

describe("Pager", () => {
  const renderPager = (total: number, entry = "/list") =>
    render(<PagerOf total={total} />, { wrapper: wrapperAt(entry) });

  test("the rows shown out of how many, the page out of how many", () => {
    renderPager(120);
    expect(screen.getByText("1–50 of 120")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeInTheDocument();
  });

  test("on the first page, no way back; on the last, no way on", () => {
    renderPager(120);
    expect(screen.getByRole("button", { name: "First" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Last" }));
    expect(screen.getByText("101–120 of 120")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Last" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText("51–100 of 120")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "First" }));
    expect(screen.getByText("1–50 of 120")).toBeInTheDocument();
  });

  test("the sizes of oc3 on offer: 25, 50, 100", () => {
    renderPager(120);
    const select = screen.getByLabelText("Per page");
    expect([...(select as HTMLSelectElement).options].map((o) => o.value)).toEqual(["25", "50", "100"]);
    fireEvent.change(select, { target: { value: "100" } });
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
  });

  test("its narrow form: glyphs and the page as 2/3 shown, the names kept for assistive tools", () => {
    renderPager(120);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const short = screen.getByText("2/3");
    expect(short).toHaveAttribute("aria-hidden", "true");
    expect(short).toHaveClass("hidden", "max-md:inline");
    expect(screen.getByText("Page 2 of 3")).toHaveClass("max-md:sr-only");
    expect(screen.getByText("Per page")).toHaveClass("max-md:sr-only");
    const glyphs = ["First", "Previous", "Next", "Last"].map(
      (name) => screen.getByRole("button", { name }).querySelector('[aria-hidden="true"]')?.textContent,
    );
    expect(glyphs).toEqual(["«", "‹", "›", "»"]);
  });

  test("an empty list: none of none, a single page", () => {
    renderPager(0);
    expect(screen.getByText("0–0 of 0")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});
