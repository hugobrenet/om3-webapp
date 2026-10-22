import { cn } from "../cn";

export type UsageState = "up" | "warn" | "down";

const FILL: Record<UsageState, string> = {
  up: "bg-state-up",
  warn: "bg-state-warn",
  down: "bg-state-down",
};

/**
 * State of a usage percentage: warn above `warn`, down above `down` (50 and 80 by
 * default, as the om3 usage columns).
 */
export function usageState(percent: number, { warn = 50, down = 80 } = {}): UsageState {
  return percent > down ? "down" : percent > warn ? "warn" : "up";
}

/**
 * A percentage with a small bar beside it, not under it: the row keeps the height of
 * one line. The bar is a `progressbar` for assistive technologies, its fill in the
 * state colour (`state`, else from `usageState`). `showValue` writes the value
 * before the bar, rounded to `digits`, or `text` in its place (a load, say).
 *
 * The value stands right-aligned in a slot of fixed width, the bar after it of a
 * fixed width too: the whole is as wide on every row, so that down a column the
 * values line up on their right edge and the bars on both of theirs, whatever the
 * value. Without a value (`value` undefined), `missing` takes the slot and the bar
 * an empty track, the row keeping the line of the others.
 */
export function UsageBar({
  value,
  text,
  missing = "–",
  state,
  label,
  title,
  showValue = true,
  digits = 1,
  className,
}: {
  /** Percentage, 0 to 100; more is drawn full. Undefined: nothing to tell. */
  value: number | undefined;
  /** What the slot says instead of the percentage. */
  text?: string;
  /** What the slot says without a value. */
  missing?: string;
  state?: UsageState;
  /** Accessible name of the bar. */
  label?: string;
  /** Tooltip of the whole, such as "used/size". */
  title?: string;
  showValue?: boolean;
  digits?: number;
  className?: string;
}) {
  const slot = "inline-block w-[7ch] shrink-0 text-right tabular-nums";
  const track = "inline-block h-1 w-12 shrink-0 overflow-hidden rounded-full bg-surface-sunken";
  if (value === undefined || !Number.isFinite(value)) {
    return (
      <span className={cn("inline-flex items-center gap-2 whitespace-nowrap", className)} title={title}>
        <span className={cn(slot, "text-ink-muted")}>{missing}</span>
        <span aria-hidden="true" className={track} />
      </span>
    );
  }
  const shown = Number(value.toFixed(digits));
  const tone = state ?? usageState(shown);
  return (
    <span className={cn("inline-flex items-center gap-2 whitespace-nowrap", className)} title={title}>
      {showValue && <span className={slot}>{text ?? `${value.toFixed(digits)}%`}</span>}
      <span
        role="progressbar"
        aria-label={label}
        aria-valuenow={shown}
        aria-valuemin={0}
        aria-valuemax={100}
        data-state={tone}
        className={track}
      >
        <span
          className={cn("block h-full rounded-full", FILL[tone])}
          style={{ width: `${Math.min(Math.max(shown, 0), 100)}%` }}
        />
      </span>
    </span>
  );
}
