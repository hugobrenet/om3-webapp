import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { cn } from "../ui/cn";
import { AlertTriangleIcon, InfoIcon } from "../ui/icons";
import type { Level, RowNote } from "./statusboard";

const LEVELS: Record<Level, { ink: string; Icon: typeof InfoIcon }> = {
  error: { ink: "text-state-down", Icon: AlertTriangleIcon },
  warn: { ink: "text-state-warn", Icon: AlertTriangleIcon },
  info: { ink: "text-ink-muted", Icon: InfoIcon },
};

/** Room kept between the card and the edges of the window. */
const MARGIN = 8;
/** Width of the card, as `max-w-sm`. */
const WIDTH = 384;

/**
 * The notes about what it wraps, a cell or a row of the status board, shown in a
 * card under it while the pointer is over it or the focus within it: what om says
 * about the resource on the node, without going down to the notes. What the cell
 * shows comes first, in words. Nothing more when there is neither.
 *
 * The card is in a portal, placed against the window: a side panel sliding in with
 * a translation would otherwise be its reference, and a table scrolling sideways
 * would clip it.
 */
export function HoverNotes({
  notes,
  showNodes = false,
  details = [],
  fill = false,
  children,
}: {
  notes: RowNote[];
  /** Says the nodes of each note: for a row, which is about all of them. */
  showNodes?: boolean;
  /** What it shows, in words, said first: the status of a cell, its marks, its flags. */
  details?: string[];
  /** Takes the whole width of its cell: the card answers anywhere in it. */
  fill?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  // A click opens the actions: the card leaves them the room until the pointer goes.
  const clicked = useRef(false);

  if (notes.length === 0 && details.length === 0) return <>{children}</>;

  const show = () => {
    if (clicked.current) return;
    const rect = anchor.current?.getBoundingClientRect();
    if (rect === undefined) return;
    const left = Math.max(MARGIN, Math.min(rect.left, window.innerWidth - WIDTH - MARGIN));
    setPlace({ top: rect.bottom + 4, left });
  };
  const hide = () => setPlace(null);

  return (
    <span
      ref={anchor}
      aria-describedby={place === null ? undefined : id}
      onMouseEnter={show}
      onMouseLeave={() => {
        clicked.current = false;
        hide();
      }}
      // From the keyboard only: a click focuses too, and opens the actions.
      onFocus={(event) => {
        if (event.target instanceof Element && event.target.matches(":focus-visible")) show();
      }}
      onBlur={hide}
      onMouseDown={() => {
        clicked.current = true;
        hide();
      }}
      className={fill ? "flex w-full" : "inline-flex"}
    >
      {children}
      {place !== null &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            style={place}
            className="pointer-events-none fixed z-[1250] w-max max-w-sm space-y-1.5 rounded-(--radius-panel) border border-line bg-surface-raised p-2 text-data shadow-lg"
          >
            {details.length > 0 && (
              <p className={cn("text-ink", notes.length > 0 && "border-b border-line pb-1.5")}>{details.join(" · ")}</p>
            )}
            {notes.map((n, i) => {
              const { ink, Icon } = LEVELS[n.level];
              return (
                <div key={i} className="flex gap-2">
                  <span className={cn("mt-0.5 shrink-0", ink)}>
                    <Icon className="h-3.5 w-3.5" />
                    <span className="sr-only">{t(`statusBoard.levels.${n.level}`)}</span>
                  </span>
                  <div className="min-w-0">
                    {(n.marker !== "" || (showNodes && n.nodes !== "")) && (
                      <p className="flex gap-2 text-ink-muted">
                        {n.marker !== "" && <sup className={cn("font-medium", ink)}>{n.marker}</sup>}
                        {showNodes && n.nodes !== "" && (
                          <span>{n.nodes === "all" ? t("statusBoard.allNodes") : n.nodes}</span>
                        )}
                      </p>
                    )}
                    <p className={n.level === "info" ? "text-ink-muted" : "text-ink"}>{n.text}</p>
                  </div>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </span>
  );
}
