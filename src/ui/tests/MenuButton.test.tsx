import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MenuButton, horizontalPlacement, submenuShift, verticalPlacement, type MenuItem } from "../components/MenuButton";
import { Dialog } from "../components/Dialog";

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
  test("the actions: of the accent fill, as every button changing a state, the corners of the controls", () => {
    render(<MenuButton label="Actions" items={items()} prominent />);
    const button = screen.getByRole("button", { name: "Actions" });
    expect(button).toHaveClass("rounded-(--radius-control)", "bg-accent", "text-accent-ink", "aria-expanded:brightness-110");
    expect(button).not.toHaveClass("rounded-(--radius-pill)", "border-line");
    expect(button).toHaveTextContent("Actions");
  });

  test("solid, of the accent fill as the actions: its text in a wide window, its icon alone in a narrow one, named by its label", () => {
    render(<MenuButton label="Node actions" text="Actions" items={items()} solid icon={<svg data-testid="bolt" />} />);
    const button = screen.getByRole("button", { name: "Node actions" });
    expect(button).toHaveClass("max-md:w-7", "bg-accent", "text-accent-ink");
    expect(button).toHaveTextContent(/^Actions$/);
    expect(screen.getByText("Actions")).toHaveClass("max-md:hidden");
    expect(screen.getByTestId("bolt").parentElement).toHaveClass("hidden", "max-md:inline-flex");
  });

  test("its label in a wide window, its icon alone in a narrow one, the label then its name and tooltip", () => {
    render(<MenuButton label="Actions" items={items()} prominent icon={<svg data-testid="bolt" />} />);
    const button = screen.getByRole("button", { name: "Actions" });
    const icon = screen.getByTestId("bolt").parentElement!;
    expect(icon).toHaveClass("hidden", "max-md:inline-flex");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Actions")).toHaveClass("max-md:sr-only");
    expect(button).toHaveClass("max-md:w-7");
  });
});

describe("MenuButton groups", () => {
  test("a mega menu: its sections under their headings, in a masonry, each whole, each entry with what it does, the harmful ones red", async () => {
    const user = userEvent.setup();
    const go = vi.fn();
    render(
      <MenuButton
        label="Node"
        columns={2}
        items={[
          { key: "freeze", label: "Freeze", description: "Stop orchestrating.", heading: "Node", onSelect: go },
          { key: "asset", label: "Asset", description: "Push the inventory.", heading: "Inventory" },
          { key: "stop", label: "Stop", description: "Stop the daemon.", heading: "Daemon", danger: true },
          { key: "drain", label: "Drain", danger: true },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Node" }));
    const menu = screen.getByRole("menu", { name: "Node" });
    expect(menu.querySelector(".md\\:columns-2")).not.toBeNull();
    // The headings: not entries, said before their group.
    expect([...menu.querySelectorAll("[data-menu-heading]")].map((h) => h.textContent)).toEqual(["Node", "Inventory", "Daemon"]);
    expect(screen.getAllByRole("menuitem")).toHaveLength(4);
    // Named by its label, described by its description.
    const stop = screen.getByRole("menuitem", { name: "Stop" });
    expect(stop).toHaveAccessibleDescription("Stop the daemon.");
    expect(stop).toHaveClass("text-state-down");
    expect(screen.getByRole("menuitem", { name: "Freeze" })).not.toHaveClass("text-state-down");
    // Each section a group named by its heading, never split across two columns.
    const sections = within(menu).getAllByRole("group");
    expect(sections.map((section) => section.getAttribute("aria-label"))).toEqual(["Node", "Inventory", "Daemon"]);
    expect(sections.every((section) => section.classList.contains("break-inside-avoid"))).toBe(true);
    expect(within(sections[2]!).getAllByRole("menuitem")).toHaveLength(2);
    // The arrows walk them in their order, group after group.
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Freeze" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Asset" })).toHaveFocus();
    await user.click(screen.getByRole("menuitem", { name: "Freeze" }));
    expect(go).toHaveBeenCalled();
  });
});

describe("MenuButton badges", () => {
  test("what an entry costs, badged after its label in its tint, read with its description, not in its name", async () => {
    const user = userEvent.setup();
    render(
      <MenuButton
        label="Object"
        items={[
          {
            key: "purge",
            label: "Purge",
            description: "Unprovision, then delete it.",
            badges: [
              { key: "dataLoss", label: "data-loss", tone: "down" },
              { key: "downTime", label: "down-time", tone: "warn" },
            ],
          },
          { key: "stop", label: "Stop", badges: [{ key: "downTime", label: "down-time", tone: "warn" }] },
          { key: "drain", label: "Drain", disabled: true, badges: [{ key: "downTime", label: "down-time", tone: "warn" }] },
          { key: "start", label: "Start" },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Object" }));
    const purge = screen.getByRole("menuitem", { name: "Purge" });
    expect(purge).toHaveAccessibleDescription("data-loss down-time Unprovision, then delete it.");
    expect(purge.querySelector("[data-badge=dataLoss]")).toHaveClass("text-state-down", "rounded-(--radius-control)");
    expect(purge.querySelector("[data-badge=downTime]")).toHaveClass("text-state-warn");
    // A badge without a description: still out of the name.
    expect(screen.getByRole("menuitem", { name: "Stop" })).toHaveAccessibleDescription("down-time");
    expect(screen.getByRole("menuitem", { name: "Start" }).querySelector("[data-badge]")).toBeNull();
    // Greyed with an entry that cannot be chosen.
    const drain = screen.getByRole("menuitem", { name: "Drain" }).querySelector("[data-badge=downTime]");
    expect(drain).toHaveClass("text-ink-muted/60", "border-line");
    expect(drain).not.toHaveClass("text-state-warn");
  });
});

describe("MenuButton filter", () => {
  const rich: MenuItem[] = [
    { key: "start", label: "Start", description: "Bring up the instance.", heading: "Operator", keywords: ["start", "startstandby"] },
    { key: "stop", label: "Stop", description: "Bring down the instance.", badges: [{ key: "downTime", label: "down-time", tone: "warn" }] },
    { key: "freeze", label: "Freeze", description: "Block the automatic starts." },
    { key: "provision", label: "Provision", description: "Allocate its resources.", heading: "Admin" },
    { key: "unprovision", label: "Unprovision", description: "Free its resources.", disabled: true },
  ];
  const names = () => screen.queryAllByRole("menuitem").map((item) => document.getElementById(item.getAttribute("aria-labelledby") ?? "")?.textContent);

  test("focused on opening; what is typed keeps the entries saying it, in label, description, badge or section, their heading kept", async () => {
    const user = userEvent.setup();
    render(<MenuButton label="Actions" items={rich} columns={2} filterable filterLabel="Filter the actions" filterEmpty="No action matches." />);
    await user.click(screen.getByRole("button", { name: "Actions" }));
    const field = screen.getByRole("searchbox", { name: "Filter the actions" });
    expect(field).toHaveFocus();
    // A search field, not a login one: the password managers leave it alone.
    expect(field).toHaveAttribute("type", "search");
    expect(field).toHaveAttribute("autocomplete", "off");
    expect(field).toHaveAttribute("data-protonpass-ignore", "true");
    await user.keyboard("prov");
    // Provision and unprovision: the second section alone, under its heading.
    expect(names()).toEqual(["Provision", "Unprovision"]);
    expect([...document.querySelectorAll("[data-menu-heading]")].map((h) => h.textContent)).toEqual(["Admin"]);
    await user.clear(field);
    await user.keyboard("down-time");
    expect(names()).toEqual(["Stop"]);
    await user.clear(field);
    await user.keyboard("admin");
    expect(names()).toEqual(["Provision", "Unprovision"]);
    await user.clear(field);
    // The action as the API and om name it.
    await user.keyboard("startstandby");
    expect(names()).toEqual(["Start"]);
    await user.clear(field);
    await user.keyboard("zzz");
    expect(names()).toEqual([]);
    expect(screen.getByText("No action matches.")).toBeInTheDocument();
  });

  test("opened by a finger, the field waits for a tap: no keyboard rising over the menu", async () => {
    const user = userEvent.setup();
    render(<MenuButton label="Actions" items={rich} filterable filterLabel="Filter the actions" />);
    await user.pointer({ keys: "[TouchA]", target: screen.getByRole("button", { name: "Actions" }) });
    const field = screen.getByRole("searchbox", { name: "Filter the actions" });
    expect(field).not.toHaveFocus();
    await user.click(field);
    expect(field).toHaveFocus();
  });

  test("Down goes to the first entry kept, Up from it back to the field; Enter in the field chooses the first", async () => {
    const user = userEvent.setup();
    const chosen = vi.fn();
    render(<MenuButton label="Actions" items={rich.map((item) => ({ ...item, onSelect: () => chosen(item.key) }))} filterable />);
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.keyboard("bring");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Start" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Stop" })).toHaveFocus();
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(screen.getByRole("searchbox", { name: "Filter" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(chosen).toHaveBeenCalledWith("start");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    // Opened again, the field empty.
    await user.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.getByRole("searchbox", { name: "Filter" })).toHaveValue("");
  });

  test("an action chosen so, its confirmation takes the focus; cancelled, the focus goes back to the menu", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [pending, setPending] = useState<string | null>(null);
      return (
        <>
          <MenuButton label="Actions" items={rich.map((item) => ({ ...item, onSelect: () => setPending(item.key) }))} filterable />
          <Dialog
            open={pending !== null}
            title={`Confirm ${pending ?? ""}`}
            onClose={() => setPending(null)}
            footer={
              <button type="button" onClick={() => setPending(null)}>
                Cancel
              </button>
            }
          >
            <p>Sure?</p>
          </Dialog>
        </>
      );
    }
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.keyboard("stop{ArrowDown}{Enter}");
    const dialog = screen.getByRole("dialog", { name: "Confirm stop" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actions" })).toHaveFocus();
  });
});

describe("horizontalPlacement", () => {
  const trigger = (left: number, right: number) => ({ left, right, top: 0, bottom: 20, width: right - left, height: 20, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;

  test("on the edge of the trigger asked, when it fits", () => {
    expect(horizontalPlacement(trigger(100, 180), 240, "start", 1600)).toEqual({ left: 100 });
    expect(horizontalPlacement(trigger(1300, 1380), 240, "end", 1600)).toEqual({ right: 220 });
  });

  test("a trigger near the right edge: the menu pushed back in, not past the window", () => {
    // An Actions button beside the rail: left 1500, a menu 300 wide in 1600.
    expect(horizontalPlacement(trigger(1500, 1600), 300, "start", 1600)).toEqual({ left: 1600 - 8 - 300 });
  });

  test("a trigger near the left edge, lined up on its right: the menu kept in the window", () => {
    expect(horizontalPlacement(trigger(10, 60), 300, "end", 1600)).toEqual({ right: 1600 - 8 - 300 });
  });

  test("a menu wider than the window: its left edge kept in", () => {
    expect(horizontalPlacement(trigger(200, 260), 2000, "start", 1600)).toEqual({ left: 8 });
  });
});
