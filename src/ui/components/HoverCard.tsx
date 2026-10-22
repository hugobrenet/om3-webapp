import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Room kept between the card and the edges of the window. */
const MARGIN = 8;
/** Width of the card at most, as `max-w-sm`. */
const WIDTH = 384;

/**
 * The details of what it wraps, in a card under it while the pointer is over it or
 * the focus within it: a cell says the gist, the card the figures behind it. With
 * `focusable` the wrapper takes the focus itself, for a cell holding nothing that
 * does, so that the keyboard reaches the card too.
 *
 * The card is in a portal, placed against the window, as HoverNotes does: a side
 * panel sliding in or a table scrolling sideways would otherwise clip it.
 */
export function HoverCard({
  card,
  focusable = false,
  children,
}: {
  card: ReactNode;
  focusable?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);

  const show = () => {
    const rect = anchor.current?.getBoundingClientRect();
    if (rect === undefined) return;
    const left = Math.max(MARGIN, Math.min(rect.left, window.innerWidth - WIDTH - MARGIN));
    setPlace({ top: rect.bottom + 4, left });
  };
  const hide = () => setPlace(null);

  return (
    <span
      ref={anchor}
      tabIndex={focusable ? 0 : undefined}
      aria-describedby={place === null ? undefined : id}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(event) => {
        if (event.key === "Escape") hide();
      }}
      className="inline-flex rounded-(--radius-control) focus-visible:outline-2 focus-visible:outline-accent"
    >
      {children}
      {place !== null &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            style={place}
            className="pointer-events-none fixed z-[1250] w-max max-w-sm rounded-(--radius-panel) border border-line bg-surface-raised p-2 text-data text-ink shadow-lg"
          >
            {card}
          </div>,
          document.body,
        )}
    </span>
  );
}
