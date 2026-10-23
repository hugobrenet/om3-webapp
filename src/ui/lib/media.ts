import { useSyncExternalStore } from "react";

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
