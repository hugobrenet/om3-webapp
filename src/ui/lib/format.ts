/**
 * Formatting of collector values. The units and date formats come from the historical
 * database: this is where their quirks are absorbed.
 */

/**
 * Sizes stored in mebibytes by the collector, whatever the column is called:
 * `mem_bytes` is 4096 on a node with 4 GiB, and `disk_size` is 40960 on a 40 GiB
 * disk.
 */
export function formatSizeMiB(value: number | undefined, locale: string): string {
  if (value === undefined || value <= 0) return "";
  // Below the gibibyte, in mebibytes: 16 MiB shown as "0 GiB" would say nothing.
  if (value < 1024) return `${value.toLocaleString(locale, { maximumFractionDigits: 0 })} MiB`;
  const gib = value / 1024;
  return `${gib.toLocaleString(locale, { maximumFractionDigits: gib < 10 ? 1 : 0 })} GiB`;
}

/** Sizes in bytes, as the om3 daemon gives them: a disk, a region. */
export function formatBytes(value: number | undefined, locale: string): string {
  if (value === undefined || value <= 0) return "";
  // Below the mebibyte, in kibibytes: a DVD drive's 374 KiB shown as "0 MiB" would say nothing.
  if (value < 1024 * 1024) return `${(value / 1024).toLocaleString(locale, { maximumFractionDigits: 0 })} KiB`;
  return formatSizeMiB(Math.round(value / 1024 / 1024), locale);
}

/**
 * The collector returns "2026-09-15 15:06:23.000", which is not ISO 8601: without the
 * T, Safari refuses to parse it.
 *
 * The timestamp carries no time zone: it is read in the browser's one, and is
 * therefore right only as long as the browser keeps the collector's time. See
 * notes.md.
 */
export function parseCollectorDate(value: string | undefined): Date | null {
  if (value === undefined || value === "") return null;
  const parsed = new Date(value.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Localised date and time, or the value as it is when it is not one. */
export function formatDateTime(value: string | undefined, locale: string): string {
  if (value === undefined || value === "") return "";
  const parsed = parseCollectorDate(value);
  if (parsed === null) return value;
  return parsed.toLocaleString(locale, { dateStyle: "short", timeStyle: "medium" });
}

/**
 * Date alone, localised, for deadlines whose time says nothing: obsolescence dates
 * are entered by the day and stored at midnight.
 */
export function formatDate(value: string | undefined, locale: string): string {
  if (value === undefined || value === "") return "";
  const parsed = parseCollectorDate(value);
  if (parsed === null) return value;
  return parsed.toLocaleDateString(locale, { dateStyle: "medium" });
}

/** Steps from the largest to the smallest, in seconds. */
const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/**
 * Distance from now, in words: "5 minutes ago", "yesterday".
 *
 * The unit kept is the largest that fits, and the distance is truncated rather than
 * rounded: at 90 seconds one reads "1 minute ago" and not "2 minutes ago", so that a
 * contact is never announced as older than it is.
 */
export function formatRelativeTime(
  value: string | undefined,
  locale: string,
  now: number = Date.now(),
): string {
  if (value === undefined || value === "") return "";
  const parsed = parseCollectorDate(value);
  if (parsed === null) return value;
  const seconds = (parsed.getTime() - now) / 1000;
  const absolute = Math.abs(seconds);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (absolute >= size || unit === "second") {
      return format.format(Math.trunc(seconds / size), unit);
    }
  }
  return "";
}

/** `formatRelativeTime` for an instant in milliseconds since the epoch. */
export function formatRelativeInstant(at: number, locale: string, now: number = Date.now()): string {
  const seconds = (at - now) / 1000;
  const absolute = Math.abs(seconds);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (absolute >= size || unit === "second") {
      return format.format(Math.trunc(seconds / size), unit);
    }
  }
  return "";
}

/** A duration in seconds, in its two largest units: "3 d 4 h", "12 min", "15 s". */
export function formatDuration(seconds: number, locale: string): string {
  const units: [number, Intl.NumberFormatOptions["unit"]][] = [
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
    [1, "second"],
  ];
  const parts: string[] = [];
  let rest = Math.max(0, Math.round(seconds));
  for (const [size, unit] of units) {
    const n = Math.floor(rest / size);
    if (n > 0 || (parts.length === 0 && size === 1)) {
      parts.push(
        new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "narrow" }).format(n),
      );
      rest -= n * size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(" ");
}

/** A percent, with up to two decimals, in the locale. */
export function formatPercent(value: number, locale: string, digits = 2): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} %`;
}
