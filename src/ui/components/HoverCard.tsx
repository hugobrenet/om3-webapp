import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../cn";
import { usePlaceCard } from "./card-place";

/** How long the pointer stays on what it wraps before the card shows: a pointer passing by shows none. */
export const HOVER_CARD_DELAY_MS = 800;

/**
 * The details of what it wraps, in a card under it: once the pointer has stayed on
 * it a moment, gone with the pointer; at once by a click, Enter or Space, kept then
 * until the same again, Escape, the focus leaving or a scroll. The click stays there,
 * not reaching a row it sits in. With `inert`, in a button whose click is its own,
 * the hover alone, and the click left to the button.
 *
 * The card is in a portal, placed against the window: a side panel sliding in or a
 * table scrolling sideways would otherwise clip it. `className`, the room the pointer
 * shows it from, wider than what it wraps.
 */
export function HoverCard({
  card,
  inert = false,
  className,
  children,
}: {
  card: ReactNode;
  inert?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number; right: number } | null>(null);
  const shown = useRef<HTMLDivElement>(null);
  usePlaceCard(shown, place);
  const timer = useRef<number | undefined>(undefined);
  // Opened by a click or a key: the pointer leaving keeps it.
  const kept = useRef(false);

  const open = place !== null;
  const show = () => {
    const rect = anchor.current?.getBoundingClientRect();
    if (rect === undefined) return;
    // Under it, its left edge on the element's until drawn: placed by its width then (usePlaceCard).
    setPlace({ top: rect.bottom + 4, left: rect.left, right: rect.right });
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    kept.current = false;
    setPlace(null);
  };
  const toggle = (event: MouseEvent | KeyboardEvent) => {
    event.stopPropagation();
    window.clearTimeout(timer.current);
    if (kept.current) {
      hide();
    } else {
      kept.current = true;
      show();
    }
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return undefined;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [open]);

  return (
    <span
      ref={anchor}
      tabIndex={inert ? undefined : 0}
      role={inert ? undefined : "button"}
      aria-expanded={inert ? undefined : open}
      aria-describedby={open ? id : undefined}
      onMouseEnter={() => {
        timer.current = window.setTimeout(show, HOVER_CARD_DELAY_MS);
      }}
      onMouseLeave={() => {
        window.clearTimeout(timer.current);
        if (!kept.current) setPlace(null);
      }}
      onClick={inert ? hide : toggle}
      onBlur={hide}
      onKeyDown={(event) => {
        if (event.key === "Escape") hide();
        if (!inert && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          toggle(event);
        }
      }}
      className={cn("inline-flex rounded-(--radius-control) focus-visible:outline-2 focus-visible:outline-accent", className)}
    >
      {children}
      {open &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            ref={shown}
            style={{ top: place.top, left: place.left }}
            className="pointer-events-none fixed z-[1250] w-max max-w-sm rounded-(--radius-panel) border border-line bg-surface-raised p-2 text-data text-ink shadow-lg"
          >
            {card}
          </div>,
          document.body,
        )}
    </span>
  );
}
