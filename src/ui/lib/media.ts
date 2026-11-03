import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Whether a media query matches, following its changes. False where the browser
 * has no `matchMedia` (jsdom), as for a wide screen.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => {
        list.removeEventListener("change", onChange);
      };
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
  );
}

/** A narrow window, as Tailwind's max-md: the side panels fold there. */
export const NARROW_QUERY = "(max-width: 47.95rem)";

/** The Tailwind breakpoints, for the views that switch layout in script. */
export const BREAKPOINTS = {
  sm: "(min-width: 40rem)",
  md: "(min-width: 48rem)",
  lg: "(min-width: 64rem)",
  xl: "(min-width: 80rem)",
} as const;

/** A finger as the pointer: a phone or a tablet. */
export const TOUCH_QUERY = "(pointer: coarse)";

/**
 * The part of the page in sight, following its changes: on a phone, what the
 * keyboard and the browser bars leave, which the `vh` units ignore. Null where
 * the browser has no `visualViewport` (jsdom).
 */
export function useVisualViewport(): { top: number; height: number } | null {
  const [box, setBox] = useState<{ top: number; height: number } | null>(() => readViewport());
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const onChange = () => {
      setBox(readViewport());
    };
    viewport.addEventListener("resize", onChange);
    viewport.addEventListener("scroll", onChange);
    return () => {
      viewport.removeEventListener("resize", onChange);
      viewport.removeEventListener("scroll", onChange);
    };
  }, []);
  return box;
}

function readViewport(): { top: number; height: number } | null {
  const viewport = typeof window === "undefined" ? undefined : window.visualViewport;
  return viewport ? { top: viewport.offsetTop, height: viewport.height } : null;
}
