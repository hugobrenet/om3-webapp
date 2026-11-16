import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { createPortal } from "react-dom";
import { RecordPanel } from "../RecordPanel";
import { usePanelHeader } from "../panel-header";
import { PanelReopenKey } from "../PanelReopenKey";
import { CrossLink } from "../CrossLink";
import { usePanelSearch } from "../panel-search";
import { readLastRecord, reloadRecordHistory } from "../record-history";
import { trackDone, useActionTracker } from "../action-tracker";

function token(claims: Record<string, unknown>): string {
  return `h.${btoa(JSON.stringify(claims)).replace(/=+$/, "")}.s`;
}

beforeEach(() => {
  localStorage.setItem("authToken", token({ sub: "alice" }));
  sessionStorage.clear();
  reloadRecordHistory();
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

/** The panels open: a closed one stays mounted for its animation, inert. */
const openDialogs = () => screen.queryAllByRole("dialog").filter((d) => !d.hasAttribute("inert"));

/** The URL query, to read what a click asked for. */
function Search() {
  return <output data-testid="search">{decodeURIComponent(useLocation().search)}</output>;
}

/** A view with a record panel driven by the URL, as the views have. */
function View() {
  const { peek, peektab, setPeekTab, closePeek } = usePanelSearch();
  return (
    <>
      <CrossLink kind="network" id="lo">
        lo
      </CrossLink>
      <CrossLink kind="object" id="ns1/svc/web" tab="logs">
        web
      </CrossLink>
      <CrossLink kind="object" id={undefined}>
        plain
      </CrossLink>
      {(["network", "object"] as const).map((kind) => (
        <RecordPanel
          key={kind}
          open={peek?.kind === kind}
          kind={kind}
          recordId={peek?.kind === kind ? peek.id : undefined}
          title={peek?.kind === kind ? peek.id : ""}
          onClose={closePeek}
          tabs={[
            { key: "status", label: "Status" },
            { key: "logs", label: "Logs" },
          ]}
          tab={peektab}
          onTabChange={setPeekTab}
        >
          {(active) => <p>content of {active}</p>}
        </RecordPanel>
      ))}
      <PanelReopenKey />
      <Search />
    </>
  );
}

function renderView(url = "/objects?kind=svc") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <View />
    </MemoryRouter>,
  );
}

describe("record panels", () => {
  test("a name opens its record over the view, the filters kept, on its first tab", () => {
    renderView();
    // A name as text, underlined hovered: no pill, a pill being a count filtering a page.
    expect(screen.getByRole("button", { name: "lo" })).toHaveClass("hover:underline");
    expect(screen.getByRole("button", { name: "lo" })).not.toHaveClass("rounded-full", "border");
    fireEvent.click(screen.getByRole("button", { name: "lo" }));
    expect(screen.getByTestId("search")).toHaveTextContent("?kind=svc&peek=network:lo");
    const panel = screen.getByRole("dialog", { name: "lo" });
    expect(within(panel).getByRole("tab", { name: "Status" })).toHaveAttribute("aria-selected", "true");
    expect(within(panel).getByText("content of status")).toBeInTheDocument();
  });

  test("no actions tray of its own: the navbar's, under which it opens, says the actions", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "lo" }));
    act(() => {
      trackDone({ action: "restart", label: "Restart", subject: "lo" });
    });
    const panel = screen.getByRole("dialog", { name: "lo" });
    expect(within(panel).queryByRole("button", { name: /^Actions: / })).not.toBeInTheDocument();
    act(() => {
      useActionTracker.setState({ tracked: [], revealed: 0 });
    });
  });

  test("its tabs named after the record, not the words of a missing translation", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "lo" }));
    const panel = screen.getByRole("dialog", { name: "lo" });
    expect(within(panel).getByRole("tablist")).toHaveAccessibleName("Views of lo");
  });

  test("a badge may name the tab to open on, and a tab change goes in the URL", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "web" }));
    const panel = screen.getByRole("dialog", { name: "ns1/svc/web" });
    expect(within(panel).getByText("content of logs")).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("tab", { name: "Status" }));
    expect(screen.getByTestId("search")).not.toHaveTextContent("peektab");
    expect(within(panel).getByText("content of status")).toBeInTheDocument();
  });

  test("a value without an id stays plain text", () => {
    renderView();
    expect(screen.getByText("plain").closest("button")).toBeNull();
  });

  test("an unknown tab in the URL falls back to the first one", () => {
    renderView("/objects?peek=network:lo&peektab=bogus");
    expect(screen.getByText("content of status")).toBeInTheDocument();
  });

  test("a closed panel is inert, without its tabs nor its content", () => {
    renderView();
    expect(openDialogs()).toHaveLength(0);
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByText(/content of/)).not.toBeInTheDocument();
  });

  test("the records shown fill the history, the panel itself without one", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "lo" }));
    fireEvent.click(screen.getByRole("button", { name: "web" }));
    expect(readLastRecord()).toEqual({ kind: "object", id: "ns1/svc/web" });
    const panel = screen.getByRole("dialog", { name: "ns1/svc/web" });
    expect(within(panel).queryByRole("navigation")).not.toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem("om3.history") ?? "{}").records.map((r: { id: string }) => r.id)).toEqual(["ns1/svc/web", "lo"]);
  });

  test("closed, p brings back the last record, nothing on screen to do so", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "lo" }));
    fireEvent.click(screen.getByRole("button", { name: "web" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "ns1/svc/web" })).getAllByRole("button", { name: "Close" })[0]!);
    expect(screen.getByTestId("search")).toHaveTextContent("?kind=svc");
    expect(screen.queryByRole("button", { name: /Reopen/ })).not.toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "p" });
    expect(openDialogs().map((d) => d.getAttribute("aria-label"))).toEqual(["ns1/svc/web"]);
    fireEvent.keyDown(document.body, { key: "p" });
    expect(openDialogs()).toHaveLength(0);
  });

  test("the content puts what concerns the whole record in the title bar", () => {
    function Content() {
      const slots = usePanelHeader();
      return (
        <>
          {slots.title !== null && createPortal(<span>flex</span>, slots.title)}
          {slots.actions !== null && createPortal(<button type="button">Actions</button>, slots.actions)}
        </>
      );
    }
    render(
      <MemoryRouter initialEntries={["/objects?peek=network:lo"]}>
        <RecordPanel open kind="network" recordId="lo" title="lo" onClose={() => {}}>
          {() => <Content />}
        </RecordPanel>
      </MemoryRouter>,
    );
    const actions = screen.getByRole("button", { name: "Actions" });
    // In the bar of the title, by the close button, not in the body.
    expect(actions.closest("[role=dialog] > div > div:first-child")).toContainElement(screen.getByRole("button", { name: "Close" }));
    // What qualifies the record, by its name.
    expect(screen.getByRole("heading", { name: "lo" }).nextElementSibling).toHaveTextContent("flex");
    // The actions, then the close button: no history there, the search palette proposes it.
    const bar = actions.closest("[role=dialog] > div > div:first-child") as HTMLElement;
    const names = within(bar)
      .getAllByRole("button")
      .map((button) => button.getAttribute("title") ?? button.textContent);
    expect(names).toEqual(["Actions", "Full screen", "Close"]);
  });

  test("the panels open on the right, no control to move them, whatever an earlier choice", () => {
    localStorage.setItem("om3.panelSide", "left");
    render(
      <MemoryRouter initialEntries={["/objects?peek=network:lo"]}>
        <View />
      </MemoryRouter>,
    );
    const panel = screen.getByRole("dialog", { name: "lo" });
    expect(panel).toHaveClass("right-0");
    expect(within(panel).queryByRole("button", { name: /Move the panels/ })).not.toBeInTheDocument();
  });
});

describe("RecordPanel, full screen and a new tab", () => {
  test("spread over the window by its button, in the URL; a new tab opens the record spread", () => {
    renderView("/objects?kind=svc&peek=network:lo&peektab=logs");
    const panel = openDialogs()[0];
    const link = within(panel).getByRole("link", { name: "Open in a new tab" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(new URL(link.getAttribute("href") ?? "", "http://x").searchParams.get("full")).toBe("1");
    expect(new URL(link.getAttribute("href") ?? "", "http://x").searchParams.get("peek")).toBe("network:lo");
    fireEvent.click(within(panel).getByRole("button", { name: "Full screen" }));
    expect(screen.getByTestId("search")).toHaveTextContent("full=1");
    expect(within(openDialogs()[0]).getByRole("button", { name: "Back to the side" })).toHaveAttribute("aria-pressed", "true");
    // No handle to resize it while it fills the window.
    expect(within(openDialogs()[0]).queryByRole("separator")).toBeNull();
    fireEvent.click(within(openDialogs()[0]).getByRole("button", { name: "Back to the side" }));
    expect(screen.getByTestId("search")).not.toHaveTextContent("full=1");
  });
});
