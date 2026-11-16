import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { checkedRows, useShareCheckedRows, type CheckedKind } from "../checked-rows";

describe("useShareCheckedRows", () => {
  it("tells the rows ticked, none once cleared or once the list leaves the page", () => {
    const { rerender, unmount } = renderHook(({ kind, ids }: { kind: CheckedKind; ids: string[] }) => useShareCheckedRows(kind, ids), {
      initialProps: { kind: "nodes", ids: ["dev5n1"] },
    });
    expect(checkedRows()).toEqual({ kind: "nodes", ids: ["dev5n1"] });
    rerender({ kind: "nodes", ids: [] });
    expect(checkedRows()).toBeNull();
    rerender({ kind: "nodes", ids: ["dev5n1", "dev5n2"] });
    expect(checkedRows()).toEqual({ kind: "nodes", ids: ["dev5n1", "dev5n2"] });
    unmount();
    expect(checkedRows()).toBeNull();
  });

  it("leaves the rows of the list that replaced it", () => {
    const first = renderHook(() => useShareCheckedRows("nodes", ["dev5n1"]));
    const second = renderHook(() => useShareCheckedRows("objects", ["test/svc/a"]));
    first.unmount();
    expect(checkedRows()).toEqual({ kind: "objects", ids: ["test/svc/a"] });
    second.unmount();
  });
});
