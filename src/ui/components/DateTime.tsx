import type { ReactNode } from "react";
import { CalendarIcon } from "../icons";
import { formatDate, formatDateTime, parseCollectorDate } from "../lib/format";

/**
 * Shared layout for list timestamps: a calendar icon before the value, which marks a
 * date at first glance whatever its format, absolute or relative. The whole stays on
 * one line so that the icon never ends up alone.
 */
export function DateStamp({
  date,
  title,
  children,
}: {
  date: Date;
  title?: string;
  children: ReactNode;
}) {
  return (
    <time
      dateTime={date.toISOString()}
      title={title}
      className="inline-flex items-center gap-1 whitespace-nowrap"
    >
      <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
      {children}
    </time>
  );
}

/**
 * Localised date and time, preceded by the calendar icon. `dateOnly` leaves out the
 * time, for a deadline set by the day.
 */
export function DateTime({
  value,
  locale,
  dateOnly = false,
}: {
  value: string | undefined;
  locale: string;
  dateOnly?: boolean;
}) {
  const parsed = parseCollectorDate(value);
  const text = dateOnly ? formatDate(value, locale) : formatDateTime(value, locale);
  // Empty or unreadable value: this is not a date, so no icon.
  if (parsed === null) return text;
  return <DateStamp date={parsed}>{text}</DateStamp>;
}
