import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { NodeMarker } from "../components/NodeMarker";

describe("NodeMarker", () => {
  test("a column a node, the node of the line full, the others a dot at the bottom", () => {
    const { container } = render(<NodeMarker count={3} index={1} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    const columns = [0, 4, 8].map((x) => svg.querySelectorAll(`rect[x="${String(x)}"]`).length);
    expect(columns).toEqual([1, 4, 1]);
    expect([...svg.querySelectorAll('rect[x="0"]')].map((r) => r.getAttribute("y"))).toEqual(["9"]);
    expect(svg).toHaveAttribute("width", "10");
    expect(svg).toHaveClass("text-ink");
  });

  test("faint, for the lines after the first of a node", () => {
    const { container } = render(<NodeMarker count={2} index={0} faint />);
    expect(container.querySelector("svg")).toHaveClass("text-ink-muted", "opacity-40");
  });
});
