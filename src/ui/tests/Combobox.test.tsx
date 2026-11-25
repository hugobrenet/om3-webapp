import { createRef, useState } from "react";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Combobox, type ComboboxOption } from "../components/Combobox";

const OPTIONS: ComboboxOption[] = [
  { value: "n1", label: "Node One" },
  { value: "n2", label: "Node Two" },
  { value: "s1", label: "Service" },
];

beforeAll(() => {
  // jsdom has no layout: scrollIntoView, called on the active option, is missing.
  Element.prototype.scrollIntoView = vi.fn();
});

function Harness({
  initial = "",
  onChange,
  onSubmit,
}: {
  initial?: string;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <Combobox
        options={OPTIONS}
        value={value}
        label="Target"
        placeholder="Pick one"
        emptyText="No match"
        onChange={(next) => {
          onChange?.(next);
          setValue(next);
        }}
      />
      <output data-testid="value">{value}</output>
    </form>
  );
}

describe("Combobox", () => {
  test("is a named combobox controlling a closed listbox", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Target" });
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("placeholder", "Pick one");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    const list = document.getElementById(input.getAttribute("aria-controls") ?? "");
    expect(list).toHaveAttribute("role", "listbox");
    expect(list).toHaveAttribute("aria-label", "Target");
    expect(list).not.toBeVisible();
  });

  test("shows the chosen option's label", () => {
    render(<Harness initial="n2" />);
    expect(screen.getByRole("combobox")).toHaveValue("Node Two");
  });

  test("focus opens the full list and selects the text", async () => {
    const user = userEvent.setup();
    render(<Harness initial="n2" />);
    const input = screen.getByRole<HTMLInputElement>("combobox");
    await user.click(input);
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Node Two".length);
    expect(screen.getByRole("option", { name: "Node Two" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("typing filters case-insensitively and clears the current choice", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="s1" onChange={onChange} />);
    await user.click(screen.getByRole("combobox"));
    await user.keyboard("NODE");
    expect(onChange).toHaveBeenCalledWith("");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Node One",
      "Node Two",
    ]);
    expect(screen.getByRole("combobox")).toHaveValue("NODE");
  });

  test("shows the empty text when nothing matches", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("combobox"));
    await user.keyboard("zzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No match")).toBeVisible();
    expect(screen.getByRole("combobox")).not.toHaveAttribute("aria-activedescendant");
  });

  test("the arrows move the active option, Enter chooses it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole("combobox");
    await user.click(input);
    const options = screen.getAllByRole("option");
    expect(input).toHaveAttribute("aria-activedescendant", options[0]?.id);
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", options[1]?.id);
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(input).toHaveAttribute("aria-activedescendant", options[2]?.id);
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("s1");
    expect(input).toHaveValue("Service");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  test("the list opens on the chosen option: Enter keeps it, the arrows move from it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="n2" onChange={onChange} />);
    const input = screen.getByRole("combobox");
    await user.click(input);
    expect(input).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name: "Node Two" }).id);
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("n2");
    expect(input).toHaveValue("Node Two");
    // Reopened after another choice, on that one, not on the first nor on the last active.
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("s1");
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name: "Service" }).id);
    await user.keyboard("{ArrowUp}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("n2");
  });

  test("the first Enter chooses without submitting, the next one submits", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await user.click(screen.getByRole("combobox"));
    await user.keyboard("two{Enter}");
    expect(screen.getByTestId("value")).toHaveTextContent("n2");
    expect(onSubmit).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test("a click on an option chooses it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "Node One" }));
    expect(onChange).toHaveBeenCalledWith("n1");
    expect(screen.getByRole("combobox")).toHaveValue("Node One");
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "false");
  });

  test("Escape closes the list without reaching the parent, ArrowDown reopens it", async () => {
    const user = userEvent.setup();
    const onParentKey = vi.fn();
    render(
      <div onKeyDown={(event) => event.key === "Escape" && onParentKey()}>
        <Harness />
      </div>,
    );
    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.keyboard("{Escape}");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(onParentKey).not.toHaveBeenCalled();
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-expanded", "true");
    // With the list closed, Escape is left to the parent.
    await user.keyboard("{Escape}{Escape}");
    expect(onParentKey).toHaveBeenCalledTimes(1);
  });

  test("leaving the field closes the list", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Harness />
        <button type="button">Next</button>
      </>,
    );
    const input = screen.getByRole("combobox");
    await user.click(input);
    await user.tab();
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  test("hovering an option makes it the active one", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByRole("combobox");
    await user.click(input);
    const service = screen.getByRole("option", { name: "Service" });
    await user.hover(service);
    expect(input).toHaveAttribute("aria-activedescendant", service.id);
  });

  test("forwards inputRef and marks an accent choice", () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <Combobox
        options={OPTIONS}
        value=""
        onChange={() => {}}
        label="Target"
        emptyText="-"
        inputRef={ref}
        accent
      />,
    );
    const input = screen.getByRole("combobox");
    expect(ref.current).toBe(input);
    expect(input).toHaveClass("border-accent");
  });
});
