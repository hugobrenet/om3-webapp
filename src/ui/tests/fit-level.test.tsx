import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useFitLevel } from "../lib/fit-level";

/** jsdom lays nothing out: the room of the scroller, and the width of its table at each layout, said here. */
let room = 0;
let widths: number[] = [];
let resized: () => void = () => undefined;

function Probe() {
  const scroller = useRef<HTMLDivElement>(null);
  const level = useFitLevel(3, scroller);
  return (
    <div ref={scroller} data-room="">
      <table data-level={level}>
        <tbody>
          <tr>
            <td>{level}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const level = () => screen.getByRole("table").dataset.level;
const resize = (to: number) => {
  room = to;
  act(() => resized());
};

describe("useFitLevel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("a step down while wider than its room, as many as needed; up again once the room is what it needed", () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized = callback;
        }

        observe() {}

        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.dataset.room !== undefined ? room : 0;
    });
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.tagName === "TABLE" ? widths[Number(this.dataset.level)] ?? 0 : 0;
    });
    widths = [1200, 800, 300];
    room = 1400;
    render(<Probe />);
    expect(level()).toBe("0");
    // Under the widest: the next one, which fits.
    resize(1000);
    expect(level()).toBe("1");
    // Under the next too: down two, the steps passed through.
    resize(600);
    expect(level()).toBe("2");
    // Up again one at a time, once the room is what each needed.
    resize(799);
    expect(level()).toBe("2");
    resize(800);
    expect(level()).toBe("1");
    resize(1200);
    expect(level()).toBe("0");
  });

  test("no ResizeObserver: the widest", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(<Probe />);
    expect(level()).toBe("0");
  });
});
