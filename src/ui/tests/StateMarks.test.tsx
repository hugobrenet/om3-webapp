import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { hasTimestamp, NotProvisionedMark, RpoBreachedMark, StoppedMark } from "../components/StateMarks";
import { PauseIcon, StopIcon } from "../icons";

describe("hasTimestamp", () => {
  test("is true for a set om3 timestamp only", () => {
    expect(hasTimestamp("2026-10-05T10:00:00Z")).toBe(true);
    expect(hasTimestamp("0001-01-01T00:00:00Z")).toBe(false);
    expect(hasTimestamp("")).toBe(false);
    expect(hasTimestamp(null)).toBe(false);
    expect(hasTimestamp(undefined)).toBe(false);
  });
});

describe("StoppedMark", () => {
  test("names the state and gives the stop date as its tooltip", () => {
    render(<StoppedMark stoppedAt="2026-10-05T10:00:00Z" label="Instance on node n1 is stopped" />);
    const mark = screen.getByRole("img", { name: "Instance on node n1 is stopped" });
    expect(mark.getAttribute("title")).toMatch(/^stopped at /);
    expect(mark).toHaveClass("text-ink-muted");
    expect(mark.querySelector("svg")).not.toBeNull();
  });

  test("draws the pause bars, not the stop square a gray down is drawn with", () => {
    const glyph = (el: JSX.Element) => render(el).container.querySelector("svg")?.innerHTML;
    const mark = render(<StoppedMark />).container.querySelector("svg")?.innerHTML;
    expect(mark).toBe(glyph(<PauseIcon />));
    expect(mark).not.toBe(glyph(<StopIcon />));
  });

  test("says stopped without a date when it has none", () => {
    render(<StoppedMark />);
    expect(screen.getByRole("img", { name: "Stopped" })).toHaveAttribute("title", "stopped");
  });
});

describe("RpoBreachedMark", () => {
  test("is a warn mark named after the breach", () => {
    render(<RpoBreachedMark label="Instance on node n1 is lagging" />);
    const mark = screen.getByRole("img", { name: "Instance on node n1 is lagging" });
    expect(mark).toHaveAttribute("title", "RPO breached");
    expect(mark).toHaveClass("text-state-warn");
  });
});

describe("NotProvisionedMark", () => {
  test("a P in a red pill, named, its tooltip the label or the title given", () => {
    render(<NotProvisionedMark label="Instance on node n1 is not provisioned" title="not provisioned" />);
    const mark = screen.getByRole("img", { name: "Instance on node n1 is not provisioned" });
    expect(mark).toHaveTextContent(/^P$/);
    expect(mark).toHaveClass("border-state-down", "text-state-down");
    expect(mark).toHaveAttribute("title", "not provisioned");
  });

  test("decorative, hidden from assistive technologies", () => {
    const { container } = render(<NotProvisionedMark decorative />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});
