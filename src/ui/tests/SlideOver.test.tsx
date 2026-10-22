import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SlideOver } from "../components/SlideOver";
import { useAnyPanelOpen } from "../components/slide-over-open";
import { DEFAULT_WIDTH, MIN_WIDTH, setPanelWidth } from "../components/slide-over-width";

afterEach(() => {
  setPanelWidth("default", undefined);
  localStorage.clear();
});

function Harness({
  onClose,
  rail,
  closeOnOutsideClick,
}: {
  onClose?: () => void;
  rail?: ReactNode;
  closeOnOutsideClick?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open node
      </button>
      <p>Page background</p>
      <SlideOver
        open={open}
        title="node-1"
        closeLabel="Close"
        rail={rail}
        closeOnOutsideClick={closeOnOutsideClick}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
      >
        <input aria-label="Comment" />
      </SlideOver>
    </>
  );
}

describe("SlideOver", () => {
  test("closed, it stays mounted but inert and slid away", () => {
    render(
      <SlideOver open={false} title="node-1" closeLabel="Close" onClose={() => {}}>
        Body
      </SlideOver>,
    );
    // Testing Library does not treat inert as hidden: the attribute is what counts.
    const panel = screen.getByRole("dialog", { name: "node-1" });
    expect(panel).toHaveAttribute("inert");
    expect(panel).toHaveClass("translate-x-full");
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  test("open, it is a non-modal dialog named by its title", () => {
    render(
      <SlideOver open title="node-1" closeLabel="Close" onClose={() => {}}>
        Body
      </SlideOver>,
    );
    const panel = screen.getByRole("dialog", { name: "node-1" });
    expect(panel).toHaveAttribute("aria-modal", "false");
    expect(panel).not.toHaveAttribute("inert");
    expect(panel).toHaveClass("translate-x-0");
    expect(screen.getByRole("heading", { name: "node-1" })).toBeInTheDocument();
  });

  test("renders leading, subheader and actions around the title", () => {
    render(
      <SlideOver
        open
        title="node-1"
        closeLabel="Close"
        onClose={() => {}}
        leading={<svg data-testid="leading" />}
        subheader={<div role="tablist" aria-label="Sections" />}
        actions={<button type="button">Bookmark</button>}
      >
        Body
      </SlideOver>,
    );
    const heading = screen.getByRole("heading", { name: "node-1" });
    expect(heading.previousElementSibling).toBe(screen.getByTestId("leading"));
    expect(screen.getByRole("tablist", { name: "Sections" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bookmark" })).toBeInTheDocument();
  });

  test("heading replaces leading and the plain title, the title still naming the dialog", () => {
    render(
      <SlideOver
        open
        title="node-1"
        closeLabel="Close"
        onClose={() => {}}
        leading={<svg data-testid="leading" />}
        heading={<h2>Node node-1, frozen</h2>}
      >
        Body
      </SlideOver>,
    );
    expect(screen.getByRole("dialog", { name: "node-1" })).toBeInTheDocument();
    expect(screen.getByRole("heading")).toHaveTextContent("Node node-1, frozen");
    expect(screen.queryByTestId("leading")).not.toBeInTheDocument();
  });

  test("applies the width of its size", () => {
    render(
      <SlideOver open size="wide" title="t" closeLabel="Close" onClose={() => {}}>
        Body
      </SlideOver>,
    );
    expect(screen.getByRole("dialog").firstElementChild).toHaveClass("max-w-3xl");
  });

  test("the close button and Escape call onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SlideOver open title="node-1" closeLabel="Close panel" onClose={onClose}>
        Body
      </SlideOver>,
    );
    const close = screen.getByRole("button", { name: "Close panel" });
    expect(close).toHaveAttribute("title", "Close panel");
    await user.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  test("closed, Escape does nothing", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SlideOver open={false} title="node-1" closeLabel="Close" onClose={onClose}>
        Body
      </SlideOver>,
    );
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  test("opening focuses the panel, closing gives the focus back to the opener", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open node" });
    await user.click(opener);
    expect(screen.getByRole("dialog", { name: "node-1" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toHaveAttribute("inert");
    expect(opener).toHaveFocus();
  });

  test("a click on an inert background closes, on a control or inside does not", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Open node" }));
    fireEvent.pointerDown(screen.getByRole("heading", { name: "node-1" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Open node" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByText("Page background"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("a click beside it does not close it while a field inside has the focus", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Open node" }));
    screen.getByRole("textbox", { name: "Comment" }).focus();
    fireEvent.pointerDown(screen.getByText("Page background"));
    expect(onClose).not.toHaveBeenCalled();
  });

  test("closeOnOutsideClick false keeps it open on a click beside it", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} closeOnOutsideClick={false} />);
    await user.click(screen.getByRole("button", { name: "Open node" }));
    fireEvent.pointerDown(screen.getByText("Page background"));
    expect(onClose).not.toHaveBeenCalled();
  });

  test("the rail shows only while open", () => {
    const { rerender } = render(
      <SlideOver open={false} title="t" closeLabel="Close" onClose={() => {}} rail={<nav>History</nav>}>
        Body
      </SlideOver>,
    );
    expect(screen.queryByText("History")).not.toBeInTheDocument();
    rerender(
      <SlideOver open title="t" closeLabel="Close" onClose={() => {}} rail={<nav>History</nav>}>
        Body
      </SlideOver>,
    );
    expect(screen.getByText("History")).toBeInTheDocument();
  });

  test("the p key closes a record panel, not another", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <SlideOver open title="t" closeLabel="Close" onClose={onClose}>
        Body
      </SlideOver>,
    );
    await user.keyboard("p");
    expect(onClose).not.toHaveBeenCalled();
    rerender(
      <SlideOver open title="t" closeLabel="Close" onClose={onClose} reopenable>
        Body
      </SlideOver>,
    );
    await user.keyboard("p");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("from the panel, Down goes to its first row that opens something, Up to its last", () => {
    render(
      <SlideOver open title="t" closeLabel="Close" onClose={() => {}}>
        <table>
          <tbody>
            <tr><td>plain</td></tr>
            <tr tabIndex={0}><td>first</td></tr>
            <tr tabIndex={0}><td>last</td></tr>
          </tbody>
        </table>
      </SlideOver>,
    );
    const panel = screen.getByRole("dialog", { name: "t" });
    expect(panel).toHaveFocus();
    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(screen.getByRole("row", { name: "first" })).toHaveFocus();
    panel.focus();
    fireEvent.keyDown(panel, { key: "ArrowUp" });
    expect(screen.getByRole("row", { name: "last" })).toHaveFocus();
  });

  test("another record shown while open, the focus lost: the panel takes it back; kept inside, it stays", () => {
    const { rerender } = render(
      <SlideOver open title="a" closeLabel="Close" onClose={() => {}}>
        <input aria-label="field" />
      </SlideOver>,
    );
    const panel = screen.getByRole("dialog", { name: "a" });
    // What chose the record, gone with the choice.
    (document.activeElement as HTMLElement).blur();
    expect(document.body).toHaveFocus();
    rerender(
      <SlideOver open title="b" closeLabel="Close" onClose={() => {}}>
        <input aria-label="field" />
      </SlideOver>,
    );
    expect(panel).toHaveFocus();
    screen.getByRole("textbox", { name: "field" }).focus();
    rerender(
      <SlideOver open title="c" closeLabel="Close" onClose={() => {}}>
        <input aria-label="field" />
      </SlideOver>,
    );
    expect(screen.getByRole("textbox", { name: "field" })).toHaveFocus();
  });

  test("counts among the open panels while open", () => {
    const counter = renderHook(() => useAnyPanelOpen());
    expect(counter.result.current).toBe(false);
    const { rerender, unmount } = render(
      <SlideOver open title="t" closeLabel="Close" onClose={() => {}}>
        Body
      </SlideOver>,
    );
    expect(counter.result.current).toBe(true);
    rerender(
      <SlideOver open={false} title="t" closeLabel="Close" onClose={() => {}}>
        Body
      </SlideOver>,
    );
    expect(counter.result.current).toBe(false);
    unmount();
  });

  describe("resize handle", () => {
    test("is shown only with a resizeLabel, and only while open", () => {
      const { rerender } = render(
        <SlideOver open title="t" closeLabel="Close" onClose={() => {}}>
          Body
        </SlideOver>,
      );
      expect(screen.queryByRole("separator")).not.toBeInTheDocument();
      rerender(
        <SlideOver open title="t" closeLabel="Close" onClose={() => {}} resizeLabel="Resize">
          Body
        </SlideOver>,
      );
      const handle = screen.getByRole("separator", { name: "Resize" });
      expect(handle).toHaveAttribute("aria-orientation", "vertical");
      expect(handle).toHaveAttribute("aria-valuenow", String(DEFAULT_WIDTH.default));
      expect(handle).toHaveAttribute("aria-valuemin", String(MIN_WIDTH));
      rerender(
        <SlideOver open={false} title="t" closeLabel="Close" onClose={() => {}} resizeLabel="Resize">
          Body
        </SlideOver>,
      );
      expect(screen.queryByRole("separator", { hidden: true })).not.toBeInTheDocument();
    });

    test("the arrows set a width, Enter gives the default one back", async () => {
      const user = userEvent.setup();
      render(
        <SlideOver open title="t" closeLabel="Close" onClose={() => {}} resizeLabel="Resize">
          Body
        </SlideOver>,
      );
      const handle = screen.getByRole("separator", { name: "Resize" });
      handle.focus();
      // jsdom has no layout: the zone measures 0, and the width is clamped to the minimum.
      await user.keyboard("{ArrowLeft}");
      expect(handle).toHaveAttribute("aria-valuenow", String(MIN_WIDTH));
      expect(screen.getByRole("dialog")).toHaveStyle({ "--panel-width": `${String(MIN_WIDTH)}px` });
      expect(localStorage.getItem("oc3.panel-width")).toBe(JSON.stringify({ default: MIN_WIDTH }));
      await user.keyboard("{Enter}");
      expect(handle).toHaveAttribute("aria-valuenow", String(DEFAULT_WIDTH.default));
      expect(localStorage.getItem("oc3.panel-width")).toBeNull();
    });
  });
});
