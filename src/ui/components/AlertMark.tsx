import { cn } from "../cn";

/** The tint of an alert: orange for warn, red for down, the oc3 state colours. */
const ALERT_TINT = { warn: "bg-state-warn", down: "bg-state-down" } as const;

export type AlertLevel = keyof typeof ALERT_TINT;

/**
 * An alert, when something calls for attention: a round badge, orange or red, an
 * exclamation mark in it, what it is about in its tooltip and for screen readers.
 * The menu entries and the tabs of the objects show the same one.
 */
export function AlertMark({
  level,
  text,
  className,
  testId,
}: {
  level: AlertLevel;
  text: string;
  className?: string;
  testId?: string;
}) {
  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      data-testid={testId}
      data-level={level}
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[0.6875rem] leading-none font-bold text-surface-raised",
        ALERT_TINT[level],
        className,
      )}
    >
      <span aria-hidden="true">!</span>
    </span>
  );
}
