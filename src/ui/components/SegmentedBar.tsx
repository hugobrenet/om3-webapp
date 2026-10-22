/**
 * The series tints, in order: one per segment, the ninth taking the first again.
 * The classes are written out in full: Tailwind does not see names built at runtime.
 */
const SERIES = [
  "bg-series-1",
  "bg-series-2",
  "bg-series-3",
  "bg-series-4",
  "bg-series-5",
  "bg-series-6",
  "bg-series-7",
  "bg-series-8",
];

export interface Segment {
  name: string;
  value: number;
}

/**
 * A bar of `total`, a segment for each part of it used, the rest free: what a
 * namespace holds of each pool out of what it may hold. The segments are named for
 * screen readers (`label`), the tint telling them apart only: the cell holding the
 * bar shows them in its hover card. A total of zero draws an empty bar.
 */
export function SegmentedBar({
  segments,
  total,
  label,
  width = "w-20",
}: {
  segments: Segment[];
  total: number;
  label: string;
  /** The width class of the bar: narrow beside a figure, wider alone in a cell. */
  width?: string;
}) {
  const shown = segments.filter((segment) => segment.value > 0);
  return (
    <span
      role="img"
      aria-label={label}
      className={`flex h-1.5 shrink-0 overflow-hidden rounded-full bg-surface-sunken ${width}`}
    >
      {total > 0 &&
        shown.map((segment, index) => (
          <span
            key={segment.name}
            data-segment={segment.name}
            className={`h-full ${SERIES[index % SERIES.length]}`}
            style={{ width: `${Math.min(100, (segment.value / total) * 100)}%` }}
          />
        ))}
    </span>
  );
}
