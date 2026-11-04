import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useMediaQuery, useVisualViewport } from "../lib/media";

describe("useMediaQuery", () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });

  test("is false without matchMedia", () => {
    // @ts-expect-error jsdom has no matchMedia: simulate it explicitly
    window.matchMedia = undefined;
    const { result } = renderHook(() => useMediaQuery("(min-width: 48rem)"));
    expect(result.current).toBe(false);
  });

  test("follows the query as it changes", () => {
    let matches = true;
    const listeners = new Set<() => void>();
    window.matchMedia = vi.fn().mockImplementation(() => ({
      get matches() {
        return matches;
      },
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    }));
    const { result, unmount } = renderHook(() => useMediaQuery("(min-width: 48rem)"));
    expect(result.current).toBe(true);
    act(() => {
      matches = false;
      listeners.forEach((listener) => listener());
    });
    expect(result.current).toBe(false);
    unmount();
    expect(listeners.size).toBe(0);
  });
});

describe("useVisualViewport", () => {
  const original = window.visualViewport;
  afterEach(() => {
    Object.defineProperty(window, "visualViewport", { value: original, configurable: true });
  });

  test("is null without visualViewport", () => {
    Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true });
    const { result } = renderHook(() => useVisualViewport());
    expect(result.current).toBeNull();
  });

  test("follows the part in sight: a phone keyboard opening shortens it", () => {
    const viewport = Object.assign(new EventTarget(), { offsetTop: 0, height: 664 });
    Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
    const { result } = renderHook(() => useVisualViewport());
    expect(result.current).toEqual({ top: 0, height: 664 });
    act(() => {
      viewport.height = 364;
      viewport.offsetTop = 120;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toEqual({ top: 120, height: 364 });
  });

  test("not active, null and nothing listened to; active, the part in sight", () => {
    const viewport = Object.assign(new EventTarget(), { offsetTop: 0, height: 664 });
    const listen = vi.spyOn(viewport, "addEventListener");
    Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
    const { result, rerender } = renderHook(({ active }) => useVisualViewport(active), { initialProps: { active: false } });
    expect(result.current).toBeNull();
    expect(listen).not.toHaveBeenCalled();
    rerender({ active: true });
    expect(result.current).toEqual({ top: 0, height: 664 });
    expect(listen).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});
