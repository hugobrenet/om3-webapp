/**
 * A small line of the last values of a series, the latest at the right, for the
 * trend at a glance in a table cell. Scaled to `max` when given, a limit say, else
 * to the highest value. With fewer than two values there is no line to draw.
 */
export function Sparkline({
  values,
  max,
  label,
  width = 64,
  height = 16,
}: {
  values: number[];
  max?: number;
  label: string;
  width?: number;
  height?: number;
}) {
  const top = Math.max(max ?? 0, ...values, Number.EPSILON);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values
    .map((value, index) => `${(index * step).toFixed(1)},${(height - 1 - (value / top) * (height - 2)).toFixed(1)}`)
    .join(" ");
  return (
    <svg
      role="img"
      aria-label={label}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0 text-series-1"
    >
      <title>{label}</title>
      {values.length > 1 && (
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      )}
    </svg>
  );
}
