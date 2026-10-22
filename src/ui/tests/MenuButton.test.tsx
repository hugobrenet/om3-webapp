import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MenuButton, submenuShift, verticalPlacement, type MenuItem } from "../components/MenuButton";

function items(handlers: Record<string, () => void> = {}): MenuItem[] {
  return [
    { key: "start", label: "Start", onSelect: handlers.start },
    { key: "stop", label: "Stop", onSelect: handlers.stop, disabled: true },
    {
      key: "more",
      label: "More",
      separatorBefore: true,
      items: [
        { key: "freeze", label: "Freeze", onSelect: handlers.freeze },
        { key: "thaw", label: "Thaw", onSelect: handlers.thaw },
      ],
    },
    { key: "delete", label: "Delete", onSelect: handlers.delete },
  ];
}

function setup(handlers: Record<string, () => void> = {}) {
  const user = userEvent.setup();
  render(
    <>
      <p>Outside</p>
      <MenuButton label="Actions" items={items(handlers)} />
    </>,
  );
  const button = screen.getByRole("button", { name: "Actions" });
  return { user, button };
}

describe("MenuButton", () => {
  test("Escape closes a menu opened with the mouse, not what is around it", async () => {
    const user = userEvent.setup();
    const onPanelKey = vi.fn();
    document.addEventListener("keydown", onPanelKey);
    render(<MenuButton label="Actions" items={[{ key: "start", label: "Start", onSelect: () => {} }]} />);
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onPanelKey).not.toHaveBeenCalled();
    document.removeEventListener("keydown", onPanelKey);
  });

  test("the menu stands in the window, out of a translated panel, and its entries act", async () => {
    // A side panel slides in with a translation, which makes it the reference of
    // the fixed elements inside it: the menu was placed off its trigger.
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <div style={{ translate: "10px" }} data-testid="panel">
        <MenuButton label="Actions" items={[{ key: "start", label: "Start", onSelect }]} />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Actions" }));
    const menu = screen.getByRole("menu");
    expect(menu.parentElement).toBe(document.body);
    expect(screen.getByTestId("panel")).not.toContainElement(menu);
    await user.click(screen.getByRole("menuitem", { name: "Start" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("announces a closed menu", () => {
    const { button } = setup();
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("a click opens the menu without moving the focus, a second click closes it", async () => {
    const { user, button } = setup();
    await user.click(button);
    const menu = screen.getByRole("menu", { name: "Actions" });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", menu.id);
    expect(button).toHaveFocus();
    await user.click(button);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test.each(["{Enter}", " ", "{ArrowDown}"])("%s on the button opens on the first entry", async (key) => {
    const { user, button } = setup();
    button.focus();
    await user.keyboard(key);
    expect(screen.getByRole("menuitem", { name: "Start" })).toHaveFocus();
  });

  test("ArrowUp on the button opens on the last entry", async () => {
    const { user, button } = setup();
    button.focus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
  });

  test("the arrows, Home and End walk the top-level entries, wrapping around", async () => {
    const { user, button } = setup();
    button.focus();
    await user.keyboard("{ArrowDown}");
    const start = screen.getByRole("menuitem", { name: "Start" });
    const more = screen.getByRole("menuitem", { name: "More" });
    const remove = screen.getByRole("menuitem", { name: "Delete" });

    await user.keyboard("{End}");
    expect(remove).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(start).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(remove).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(more).toHaveFocus();
    await user.keyboard("{Home}");
    expect(start).toHaveFocus();
  });

  // MenuButton.tsx:100-107 (`move`) moves the focus to the next entry even when it is a disabled
  // <button>. Browsers do not focus a disabled button, so the walk stays stuck before
  // it; jsdom focuses it, but then no longer dispatches the keys to it. Either way the
  // entries past a disabled one cannot be reached with the arrows.
  test("the arrows walk past a disabled entry", async () => {
    const { user, button } = setup();
    button.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    const reached = [
      screen.getByRole("menuitem", { name: "More" }),
      screen.getByRole("menuitem", { name: "Delete" }),
    ];
    expect(reached).toContain(document.activeElement);
  });

  test("Escape closes the menu and gives the focus back to the button", async () => {
    const { user, button } = setup();
    button.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  test("Escape in the menu does not reach the document", async () => {
    const onDocumentKey = vi.fn();
    document.addEventListener("keydown", onDocumentKey);
    const { user, button } = setup();
    button.focus();
    await user.keyboard("{Enter}");
    onDocumentKey.mockClear();
    await user.keyboard("{Escape}");
    document.removeEventListener("keydown", onDocumentKey);
    expect(onDocumentKey).not.toHaveBeenCalled();
  });

  test("choosing an entry calls its onSelect, closes and focuses the button", async () => {
    const start = vi.fn();
    const { user, button } = setup({ start });
    await user.click(button);
    await user.click(screen.getByRole("menuitem", { name: "Start" }));
    expect(start).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  test("Enter on a focused entry chooses it", async () => {
    const remove = vi.fn();
    const { user, button } = setup({ delete: remove });
    button.focus();
    await user.keyboard("{ArrowUp}");
    await user.keyboard("{Enter}");
    expect(remove).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("a disabled entry cannot be chosen", async () => {
    const stop = vi.fn();
    const { user, button } = setup({ stop });
    await user.click(button);
    const entry = screen.getByRole("menuitem", { name: "Stop" });
    expect(entry).toBeDisabled();
    await user.click(entry);
    expect(stop).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  test("a separator marks the start of a group", async () => {
    const { user, button } = setup();
    await user.click(button);
    const separator = screen.getByRole("separator");
    expect(separator.nextElementSibling).toBe(screen.getByRole("menuitem", { name: "More" }));
  });

  test("a click outside closes the menu, a click inside does not", async () => {
    const { user, button } = setup();
    await user.click(button);
    fireEvent.pointerDown(screen.getByRole("menu"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.click(screen.getByText("Outside"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("Tab closes the menu", async () => {
    const { user, button } = setup();
    button.focus();
    await user.keyboard("{Enter}");
    await user.tab();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("a disabled menu button does not open", async () => {
    const user = userEvent.setup();
    render(<MenuButton label="Actions" items={items()} disabled />);
    const button = screen.getByRole("button", { name: "Actions" });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  describe("submenu", () => {
    async function openOnMore() {
      const handlers = { freeze: vi.fn(), thaw: vi.fn() };
      const { user, button } = setup(handlers);
      button.focus();
      await user.keyboard("{Enter}");
      const more = screen.getByRole("menuitem", { name: "More" });
      more.focus();
      return { user, button, more, handlers };
    }

    test("the opener announces its submenu", async () => {
      const { more } = await openOnMore();
      expect(more).toHaveAttribute("aria-haspopup", "menu");
      expect(more).toHaveAttribute("aria-expanded", "false");
    });

    test("ArrowRight opens it on its first entry", async () => {
      const { user, more } = await openOnMore();
      await user.keyboard("{ArrowRight}");
      const submenu = screen.getByRole("menu", { name: "More" });
      expect(more).toHaveAttribute("aria-expanded", "true");
      expect(more).toHaveAttribute("aria-controls", submenu.id);
      await waitFor(() => {
        expect(screen.getByRole("menuitem", { name: "Freeze" })).toHaveFocus();
      });
    });

    test("Enter opens it on its first entry", async () => {
      const { user } = await openOnMore();
      await user.keyboard("{Enter}");
      expect(screen.getByRole("menu", { name: "More" })).toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByRole("menuitem", { name: "Freeze" })).toHaveFocus();
      });
    });

    test("its arrows walk its own entries only", async () => {
      const { user } = await openOnMore();
      await user.keyboard("{ArrowRight}");
      await waitFor(() => {
        expect(screen.getByRole("menuitem", { name: "Freeze" })).toHaveFocus();
      });
      await user.keyboard("{ArrowDown}");
      expect(screen.getByRole("menuitem", { name: "Thaw" })).toHaveFocus();
      await user.keyboard("{ArrowDown}");
      expect(screen.getByRole("menuitem", { name: "Freeze" })).toHaveFocus();
      await user.keyboard("{End}");
      expect(screen.getByRole("menuitem", { name: "Thaw" })).toHaveFocus();
    });

    test.each(["{ArrowLeft}", "{Escape}"])(
      "%s closes it and focuses its opener, the menu staying open",
      async (key) => {
        const { user, more } = await openOnMore();
        await user.keyboard("{ArrowRight}");
        await waitFor(() => {
          expect(screen.getByRole("menuitem", { name: "Freeze" })).toHaveFocus();
        });
        await user.keyboard(key);
        expect(screen.queryByRole("menu", { name: "More" })).not.toBeInTheDocument();
        expect(screen.getByRole("menu", { name: "Actions" })).toBeInTheDocument();
        expect(more).toHaveFocus();
      },
    );

    test("choosing a submenu entry calls it and closes the whole menu", async () => {
      const { user, button, handlers } = await openOnMore();
      await user.keyboard("{ArrowRight}");
      await user.click(screen.getByRole("menuitem", { name: "Thaw" }));
      expect(handlers.thaw).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(button).toHaveFocus();
    });

    test("the pointer opens it on hover and closes it on leave", async () => {
      const { user, more } = await openOnMore();
      await user.hover(more);
      expect(screen.getByRole("menu", { name: "More" })).toBeInTheDocument();
      await user.unhover(more);
      expect(screen.queryByRole("menu", { name: "More" })).not.toBeInTheDocument();
    });
  });
});

// jsdom lays nothing out: the window is 1024 x 768, and the rectangles are given.
const rect = (top: number, bottom: number, left = 100, right = 300) =>
  ({ top, bottom, left, right, width: right - left, height: bottom - top }) as DOMRect;

describe("verticalPlacement", () => {
  test("opens under the trigger when the menu fits there", () => {
    expect(verticalPlacement(rect(100, 120), 300)).toEqual({ top: 124 });
  });

  test("opens over the trigger near the bottom of the window", () => {
    expect(verticalPlacement(rect(700, 720), 300)).toEqual({ bottom: 768 - 700 + 4 });
  });

  test("fitting nowhere, takes the roomier side, cut and scrolled", () => {
    expect(verticalPlacement(rect(500, 520), 900)).toEqual({
      bottom: 768 - 500 + 4,
      maxHeight: 500 - 4 - 8,
      overflowY: "auto",
    });
    expect(verticalPlacement(rect(200, 220), 900)).toEqual({
      top: 224,
      maxHeight: 768 - 220 - 4 - 8,
      overflowY: "auto",
    });
  });
});

describe("submenuShift", () => {
  test("stays in place inside the window", () => {
    expect(submenuShift(rect(100, 300))).toEqual({ up: 0, flip: false });
  });

  test("goes up by what passes the bottom of the window", () => {
    expect(submenuShift(rect(600, 860))).toEqual({ up: 860 - (768 - 8), flip: false });
  });

  test("never goes above the top of the window", () => {
    expect(submenuShift(rect(50, 900)).up).toBe(50 - 8);
  });

  test("goes to the other side of its entry past the right edge", () => {
    expect(submenuShift(rect(100, 300, 900, 1100)).flip).toBe(true);
  });
});

describe("MenuButton prominent", () => {
  test("the actions: outlined, as every button neither creating nor deleting, the corners of the controls", () => {
    render(<MenuButton label="Actions" items={items()} prominent />);
    const button = screen.getByRole("button", { name: "Actions" });
    expect(button).toHaveClass("rounded-(--radius-control)", "border", "border-line", "text-ink");
    expect(button).not.toHaveClass("bg-accent", "rounded-(--radius-pill)");
    expect(button).toHaveTextContent("Actions");
    expect(button).not.toHaveAttribute("title");
  });

  test("solid, drawn as the actions: its text in a wide window, its icon alone in a narrow one, named by its label", () => {
    render(<MenuButton label="Node actions" text="Actions" items={items()} solid icon={<svg data-testid="bolt" />} />);
    const button = screen.getByRole("button", { name: "Node actions" });
    expect(button).toHaveClass("max-md:w-7", "border", "border-line");
    expect(button).not.toHaveClass("bg-accent");
    expect(button).toHaveTextContent(/^Actions$/);
    expect(screen.getByText("Actions")).toHaveClass("max-md:hidden");
    expect(screen.getByTestId("bolt").parentElement).toHaveClass("hidden", "max-md:inline-flex");
    expect(button).toHaveAttribute("title", "Node actions");
  });

  test("its label in a wide window, its icon alone in a narrow one, the label then its name and tooltip", () => {
    render(<MenuButton label="Actions" items={items()} prominent icon={<svg data-testid="bolt" />} />);
    const button = screen.getByRole("button", { name: "Actions" });
    const icon = screen.getByTestId("bolt").parentElement!;
    expect(icon).toHaveClass("hidden", "max-md:inline-flex");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Actions")).toHaveClass("max-md:sr-only");
    expect(button).toHaveClass("max-md:w-7");
    expect(button).toHaveAttribute("title", "Actions");
  });
});

describe("MenuButton groups", () => {
  test("a mega menu: its groups under their headings, a column each, each entry with what it does, the harmful ones red", async () => {
    const user = userEvent.setup();
    const go = vi.fn();
    render(
      <MenuButton
        label="Node"
        columns={3}
        items={[
          { key: "freeze", label: "Freeze", description: "Stop orchestrating.", heading: "Node", column: 1, onSelect: go },
          { key: "asset", label: "Asset", description: "Push the inventory.", heading: "Inventory", column: 2 },
          { key: "stop", label: "Stop", description: "Stop the daemon.", heading: "Daemon", column: 3, danger: true },
          { key: "drain", label: "Drain", column: 3, danger: true },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Node" }));
    const menu = screen.getByRole("menu", { name: "Node" });
    expect(menu).toHaveClass("md:grid", "md:grid-cols-3", "md:grid-flow-dense");
    // The headings: not entries, said before their group.
    expect([...menu.querySelectorAll("[data-menu-heading]")].map((h) => h.textContent)).toEqual(["Node", "Inventory", "Daemon"]);
    expect(screen.getAllByRole("menuitem")).toHaveLength(4);
    // Named by its label, described by its description.
    const stop = screen.getByRole("menuitem", { name: "Stop" });
    expect(stop).toHaveAccessibleDescription("Stop the daemon.");
    expect(stop).toHaveClass("text-state-down");
    expect(screen.getByRole("menuitem", { name: "Freeze" })).not.toHaveClass("text-state-down");
    // Each in the column of its group.
    expect(stop.parentElement).toHaveClass("md:col-start-3");
    expect(screen.getByRole("menuitem", { name: "Asset" }).parentElement).toHaveClass("md:col-start-2");
    // The arrows walk them in their order, group after group.
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Freeze" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Asset" })).toHaveFocus();
    await user.click(screen.getByRole("menuitem", { name: "Freeze" }));
    expect(go).toHaveBeenCalled();
  });
});
