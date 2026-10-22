import { afterEach, describe, expect, test } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ShortcutsHelp } from "../ShortcutsHelp";
import { setShortcutsHelp } from "../../ui/lib/shortcuts";

afterEach(() => act(() => setShortcutsHelp(false)));

describe("ShortcutsHelp", () => {
  test("? opens the list of the shortcuts, as oc3's", () => {
    render(<ShortcutsHelp />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "?" });
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    for (const label of [
      "Search the cluster",
      "Open the detail panel on the record shown last, or close it",
      "Move to the left-hand menu",
      "In the menu: move between entries, Enter opens",
      "Close the panel, a list or this help; leave the menu",
      "Show this list",
    ])
      expect(dialog).toHaveTextContent(label);
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  test("Escape or ? close it, and the panel under it stays", () => {
    render(<ShortcutsHelp />);
    act(() => setShortcutsHelp(true));
    let reachedDocument = false;
    const onKey = () => {
      reachedDocument = true;
    };
    document.addEventListener("keydown", onKey);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    document.removeEventListener("keydown", onKey);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(reachedDocument).toBe(false);
    act(() => setShortcutsHelp(true));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "?" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
