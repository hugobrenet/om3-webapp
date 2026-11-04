import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { StatusBoard } from "../StatusBoard";
import { buildBoard, type ObjectData } from "../statusboard";
import dns from "./fixtures/system-svc-dns.json";

const original = window.matchMedia;

/** A phone: a finger as the pointer, a narrow window. */
function phone() {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query === "(pointer: coarse)" || query.includes("max-width"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
}

/** No room for the side columns: the board overflowing its frame at each step. */
function narrow() {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(1000);
}

afterEach(() => {
  window.matchMedia = original;
  vi.restoreAllMocks();
});

describe("StatusBoard on a touch screen", () => {
  test("a description cut short, in full on a tap, cut again on another", () => {
    phone();
    narrow();
    const board = buildBoard({ path: "system/svc/dns", object: dns as ObjectData });
    render(<StatusBoard board={board} />);
    const description = document.querySelector<HTMLButtonElement>("[data-side-text] button");
    expect(description).not.toBeNull();
    const button = description as HTMLButtonElement;
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveClass("truncate");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).not.toHaveClass("truncate");
    expect(button).toHaveClass("whitespace-normal");
    fireEvent.click(button);
    expect(button).toHaveClass("truncate");
  });

  test("with a mouse, no button: the description in its tooltip", () => {
    narrow();
    const board = buildBoard({ path: "system/svc/dns", object: dns as ObjectData });
    render(<StatusBoard board={board} />);
    const sides = [...document.querySelectorAll("[data-side-text]")];
    expect(sides.some((side) => side.getAttribute("title"))).toBe(true);
    expect(document.querySelector("[data-side-text] button")).toBeNull();
  });
});
