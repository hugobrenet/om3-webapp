import { cn } from "../cn";

/** A column of the marker: its width with the gap after it, in pixels. */
const COLUMN = 4;
/** The dots of a lit column, from the top; an unlit one has the last alone. */
const DOTS = [0, 3, 6, 9];

/**
 * Which of the nodes shown a log line comes from, as om marks it in braille (⣇⡀,
 * ⣸⡀, ⣀⡇): a column a node, in the order of the cluster, the node of the line a full
 * column of dots, the others a dot at the bottom. Drawn, it keeps its width whatever
 * the font. `faint`, for the lines after the first of a node. Decorative: the name of
 * the node says it.
 */
export function NodeMarker({ count, index, faint = false }: { count: number; index: number; faint?: boolean }) {
  const width = count * COLUMN - 2;
  return (
    <svg
      aria-hidden="true"
      data-node-marker={index}
      width={width}
      height={11}
      viewBox={`0 0 ${String(width)} 11`}
      className={cn("shrink-0 self-center", faint ? "text-ink-muted opacity-40" : "text-ink")}
      fill="currentColor"
    >
      {Array.from({ length: count }, (_, column) =>
        (column === index ? DOTS : [DOTS[DOTS.length - 1]]).map((y) => (
          <rect key={`${String(column)}-${String(y)}`} x={column * COLUMN} y={y} width={2} height={2} />
        )),
      )}
    </svg>
  );
}
