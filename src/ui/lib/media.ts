import { useCallback, useMemo, useSyncExternalStore } from "react";

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
 * the browser has no `visualViewport` (jsdom), or while not `active`: nothing
 * listened to then, a dialog closed not drawn again on each scroll.
 */
export function useVisualViewport(active = true): { top: number; height: number } | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const viewport = active ? window.visualViewport : null;
      if (!viewport) return () => {};
      viewport.addEventListener("resize", onChange);
      viewport.addEventListener("scroll", onChange);
      return () => {
        viewport.removeEventListener("resize", onChange);
        viewport.removeEventListener("scroll", onChange);
      };
    },
    [active],
  );
  // Said as a string, the same box the same snapshot: no render for nothing.
  const box = useSyncExternalStore(subscribe, () => (active ? readViewport() : ""), () => "");
  return useMemo(() => {
    if (box === "") return null;
    const [top, height] = box.split(" ").map(Number);
    return { top: top ?? 0, height: height ?? 0 };
  }, [box]);
}

function readViewport(): string {
  const viewport = typeof window === "undefined" ? undefined : window.visualViewport;
  return viewport ? `${viewport.offsetTop} ${viewport.height}` : "";
}
