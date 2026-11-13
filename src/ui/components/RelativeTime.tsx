import { DateStamp } from "./DateTime";
import { formatDateTime, formatRelativeTime, parseCollectorDate } from "../lib/format";

/**
 * Timestamp as a distance from now.
 *
 * In a list, "3 minutes ago" compares at a glance where a full date asks for a mental
 * subtraction; the full date stays on hover, and in `dateTime` for the tools that read
 * the page. Every time of the app said from now is said so, in a table or a panel.
 */
export function RelativeTime({ value, locale }: { value: string | undefined; locale: string }) {
  const parsed = parseCollectorDate(value);
  const exact = formatDateTime(value, locale);
  // Empty or unreadable value: nothing to place in time, so the raw text is rendered.
  if (parsed === null) return exact;
  return (
    <DateStamp date={parsed} title={exact}>
      {formatRelativeTime(value, locale)}
    </DateStamp>
  );
}
