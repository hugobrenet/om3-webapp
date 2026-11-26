import { beforeEach, describe, expect, test } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import "../../i18n";
import { RecordPanel } from "../RecordPanel";
import { CrossLink } from "../CrossLink";
import { usePanelSearch } from "../panel-search";
import { reloadRecordHistory } from "../record-history";
import { backTarget, forwardTarget, observePanelEntry, panelEntryOf, PanelNavTracker, resetPanelNav } from "../panel-nav";

beforeEach(() => {
  sessionStorage.clear();
  reloadRecordHistory();
  resetPanelNav();
});

const entry = (record: string | null) => ({ record, label: record ?? "" });

describe("the record of an entry of the history", () => {
  test("the row panel of its view, else the record over it, else none", () => {
    expect(panelEntryOf("/objects", "?sel=ns1/svc/web&tab=logs")).toEqual({ record: "/objects|sel|ns1/svc/web", label: "ns1/svc/web" });
    expect(panelEntryOf("/objects", "?peek=resource:ns1/svc/web:fs%231")).toEqual({
      record: "/objects|peek|resource:ns1/svc/web:fs#1",
      label: "ns1/svc/web:fs#1",
    });
    expect(panelEntryOf("/objects", "?kind=svc")).toEqual({ record: null, label: "" });
  });
});

describe("where Back and Forward go", () => {
  test("from record to record, the tab changes of one skipped, landing on the last left", () => {
    observePanelEntry(0, entry(null), true);
    observePanelEntry(1, entry("A"), true);
    // Two tabs of A.
    observePanelEntry(2, entry("A"), true);
    observePanelEntry(3, entry("B"), true);
    observePanelEntry(4, entry("B"), true);
    expect(backTarget()).toBe(2);
    expect(forwardTarget()).toBeNull();
    // Back at A's first tab, by the browser: Forward to B's last.
    observePanelEntry(1, entry("A"), false);
    expect(backTarget()).toBeNull();
    expect(forwardTarget()).toBe(4);
  });
  test("no Back past a view with no panel, nor into an entry not seen", () => {
    observePanelEntry(5, entry("A"), true);
    expect(backTarget()).toBeNull();
    observePanelEntry(6, entry(null), true);
    observePanelEntry(7, entry("B"), true);
    expect(backTarget()).toBeNull();
  });
  test("a navigation of its own drops what was ahead", () => {
    observePanelEntry(1, entry("A"), true);
    observePanelEntry(2, entry("B"), true);
    observePanelEntry(1, entry("A"), false);
    expect(forwardTarget()).toBe(2);
    observePanelEntry(2, entry("C"), true);
    observePanelEntry(1, entry("A"), false);
    expect(forwardTarget()).toBe(2);
    observePanelEntry(2, entry("C"), false);
    expect(forwardTarget()).toBeNull();
  });
});

/** A view whose records open over it, as the views have. */
function View() {
  const { peek, peektab, setPeekTab, closePeek } = usePanelSearch();
  return (
    <>
      <CrossLink kind="object" id="ns1/svc/web">
        web
      </CrossLink>
      {(["object", "resource"] as const).map((kind) => (
        <RecordPanel
          key={kind}
          open={peek?.kind === kind}
          kind={kind}
          recordId={peek?.kind === kind ? peek.id : undefined}
          title={peek?.kind === kind ? peek.id : ""}
          onClose={closePeek}
          tabs={[
            { key: "status", label: "Status" },
            { key: "resources", label: "Resources" },
          ]}
          tab={peektab}
          onTabChange={setPeekTab}
        >
          {() =>
            kind === "object" ? (
              <CrossLink kind="resource" id="ns1/svc/web:fs#1">
                fs#1
              </CrossLink>
            ) : (
              <p>the resource</p>
            )
          }
        </RecordPanel>
      ))}
    </>
  );
}

const panel = () => screen.getAllByRole("dialog").find((d) => !d.hasAttribute("inert"))!;

describe("the Back and Forward buttons of a panel", () => {
  test("a resource opened from its object: Back gives the object on its tab, Forward the resource again", async () => {
    window.history.replaceState(null, "", "/objects");
    render(
      <BrowserRouter>
        <PanelNavTracker />
        <View />
      </BrowserRouter>,
    );
    fireEvent.click(screen.getByText("web"));
    // Nothing before it, nothing after it.
    expect(within(panel()).getByRole("button", { name: "Back" })).toBeDisabled();
    expect(within(panel()).getByRole("button", { name: "Forward" })).toBeDisabled();
    fireEvent.click(within(panel()).getByRole("tab", { name: "Resources" }));
    fireEvent.click(within(panel()).getByText("fs#1"));
    expect(within(panel()).getByText("the resource")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(panel()).getByRole("button", { name: "Back to ns1/svc/web" }));
    });
    await waitFor(() => {
      expect(within(panel()).getByText("fs#1")).toBeInTheDocument();
    });
    expect(within(panel()).getByRole("tab", { name: "Resources" })).toHaveAttribute("aria-selected", "true");
    expect(within(panel()).getByRole("button", { name: "Back" })).toBeDisabled();

    await act(async () => {
      fireEvent.click(within(panel()).getByRole("button", { name: "Forward to ns1/svc/web:fs#1" }));
    });
    await waitFor(() => {
      expect(within(panel()).getByText("the resource")).toBeInTheDocument();
    });
    expect(within(panel()).getByRole("button", { name: "Forward" })).toBeDisabled();
  });
});
