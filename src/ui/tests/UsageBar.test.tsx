import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { UsageBar, usageState } from "../components/UsageBar";
import { StatusCount } from "../components/StatusCount";

describe("UsageBar", () => {
  test("states a usage by the om3 thresholds, or given ones", () => {
    expect(usageState(50)).toBe("up");
    expect(usageState(50.1)).toBe("warn");
    expect(usageState(80.1)).toBe("down");
    expect(usageState(30, { warn: 20, down: 90 })).toBe("warn");
  });

  test("writes the value and draws the bar beside it, in its state colour", () => {
    render(<UsageBar value={63.47} label="Usage" title="3/5" />);
    expect(screen.getByText("63.5%")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: "Usage" });
    expect(bar).toHaveAttribute("aria-valuenow", "63.5");
    expect(bar).toHaveAttribute("data-state", "warn");
    expect(bar.firstElementChild).toHaveClass("bg-state-warn");
    expect(bar.firstElementChild).toHaveStyle({ width: "63.5%" });
    expect(bar.parentElement).toHaveAttribute("title", "3/5");
  });

  test("takes a given state, caps the fill, and can leave the value out", () => {
    render(<UsageBar value={140} state="up" showValue={false} label="Mem" />);
    const bar = screen.getByRole("progressbar", { name: "Mem" });
    expect(bar).toHaveAttribute("data-state", "up");
    expect(bar.firstElementChild).toHaveStyle({ width: "100%" });
    expect(screen.queryByText(/%/)).toBeNull();
  });

  test("the value right-aligned in a slot of fixed width, the bar fixed too: aligned down a column", () => {
    const { container } = render(
      <>
        <UsageBar value={5} label="a" />
        <UsageBar value={100} label="b" />
        <UsageBar value={1.5} text="1.5" label="c" />
      </>,
    );
    const slots = [...container.querySelectorAll("[role=progressbar]")].map((bar) => bar.previousElementSibling);
    expect(slots.map((slot) => slot?.textContent)).toEqual(["5.0%", "100.0%", "1.5"]);
    for (const slot of slots) expect(slot).toHaveClass("w-[7ch]", "text-right", "tabular-nums");
    for (const bar of screen.getAllByRole("progressbar")) expect(bar).toHaveClass("w-12");
  });

  test("no value: the missing word in the slot, an empty track in place of the bar, no progressbar", () => {
    const { container } = render(<UsageBar value={undefined} missing="N/A" label="Usage" />);
    expect(screen.queryByRole("progressbar")).toBeNull();
    const [slot, track] = [...container.firstElementChild!.children];
    expect(slot).toHaveTextContent(/^N\/A$/);
    expect(slot).toHaveClass("w-[7ch]", "text-right");
    expect(track).toHaveClass("w-12");
    expect(track).toHaveAttribute("aria-hidden", "true");
  });
});

describe("StatusCount", () => {
  test("shows the mark and the count", () => {
    render(<StatusCount state="down" count={3} />);
    expect(screen.getByTitle("down")).toHaveAttribute("data-state", "down");
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("a clickable count is a named button that does not reach the row", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onRow = vi.fn();
    render(
      <div onClick={onRow}>
        <StatusCount state="up" count={5} label="Show the 5 up objects" onClick={onClick} markLabel="running" />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Show the 5 up objects" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
    expect(screen.getByTitle("running")).toBeInTheDocument();
  });
});
