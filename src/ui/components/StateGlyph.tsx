import { cn } from "../cn";
import type { ObjectState } from "./StatusBadge";

/**
 * The shape of a state, drawn rather than typed: ● up, ▲ warn, ■ down, / n/a, as
 * om writes it, ○ unknown.
 * IBM Plex Sans has none of these characters, so as text each browser took them
 * from a fallback font of its own, and Chrome drew them much smaller than Firefox.
 * Drawn on a 12 grid, 10px by default, in `currentColor`; decorative, the label
 * next to it or around it says the state.
 */
export function StateGlyph({ state, className }: { state: ObjectState; className?: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
      data-glyph={state}
      className={cn("h-2.5 w-2.5 shrink-0", className)}
    >
      {state === "up" && <circle cx="6" cy="6" r="5" fill="currentColor" />}
      {state === "warn" && <path d="M6 1 11.2 10.5H.8Z" fill="currentColor" />}
      {state === "down" && <rect x="1.5" y="1.5" width="9" height="9" fill="currentColor" />}
      {state === "na" && (
        <path d="M9.5 .8 2.5 11.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      )}
      {state === "unknown" && (
        <circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      )}
    </svg>
  );
}
