import { cn } from "../cn";

/**
 * The tints of a count pill: the availability states, in their colour, and the
 * neutral grey of what has no state (a secret, a configuration).
 */
const TONE = {
  up: "border-state-up text-state-up",
  warn: "border-state-warn text-state-warn",
  down: "border-state-down text-state-down",
  na: "border-state-unknown text-state-unknown",
  neutral: "border-line text-ink-muted",
} as const;

export type CountTone = keyof typeof TONE;

/**
 * A count in a small bordered pill, its border and text in the tint of what it
 * counts. The colour is not the only sign: `label` says what is counted, as the
 * tooltip and the accessible name. With `onClick` the pill is a button, which
 * stops its click so that the row under it does not open.
 */
export function CountPill({
  tone,
  count,
  label,
  onClick,
}: {
  tone: CountTone;
  count: number;
  label: string;
  onClick?: () => void;
}) {
  const className = cn(
    "inline-flex min-w-[2.5ch] justify-center rounded-(--radius-control) border px-1 text-data tabular-nums leading-tight",
    TONE[tone],
  );
  if (onClick === undefined) {
    return (
      <span className={className} title={label} aria-label={label} data-tone={tone}>
        {count}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={cn(className, "hover:bg-surface-sunken")}
      title={label}
      aria-label={label}
      data-tone={tone}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {count}
    </button>
  );
}
