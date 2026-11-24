import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatMHz,
  formatPercent,
  formatBytes,
  formatRelativeTime,
  formatSizeMiB,
  parseCollectorDate,
} from "../lib/format";
import { DateTime } from "../components/DateTime";
import { RelativeTime } from "../components/RelativeTime";

// The collector's timestamps carry no time zone: they are read in the local one.
const STAMP = "2026-09-15 15:06:23.000";
const LOCAL = new Date(2026, 8, 15, 15, 6, 23);

describe("parseCollectorDate", () => {
  test("reads the collector format, without the T, in local time", () => {
    expect(parseCollectorDate(STAMP)?.getTime()).toBe(LOCAL.getTime());
  });

  test("returns null for empty, missing or unreadable values", () => {
    expect(parseCollectorDate(undefined)).toBeNull();
    expect(parseCollectorDate("")).toBeNull();
    expect(parseCollectorDate("not a date")).toBeNull();
  });
});

describe("formatMHz", () => {
  test("below a gigahertz in megahertz, from one in gigahertz", () => {
    expect(formatMHz(800, "en")).toBe("800 MHz");
    expect(formatMHz(2000, "en")).toBe("2 GHz");
    expect(formatMHz(2400, "fr")).toBe("2,4 GHz");
    expect(formatMHz(3193, "en")).toBe("3.19 GHz");
    expect(formatMHz(0, "en")).toBe("");
  });
});

describe("formatBytes", () => {
  test("below a kibibyte, in bytes: a small key not said empty", () => {
    expect(formatBytes(1, "en")).toBe("1 B");
    expect(formatBytes(31, "en")).toBe("31 B");
    expect(formatBytes(511, "en")).toBe("511 B");
    expect(formatBytes(1023, "en")).toBe("1,023 B");
  });

  test("from a kibibyte, in kibibytes, then as the mebibytes", () => {
    expect(formatBytes(1024, "en")).toBe("1 KiB");
    expect(formatBytes(374 * 1024, "en")).toBe("374 KiB");
    expect(formatBytes(1024 * 1024, "en")).toBe("1 MiB");
  });

  test("nothing for nothing: the caller says its zero", () => {
    expect(formatBytes(0, "en")).toBe("");
    expect(formatBytes(undefined, "en")).toBe("");
  });
});

describe("formatSizeMiB", () => {
  test("below a gibibyte, in mebibytes", () => {
    expect(formatSizeMiB(16, "en")).toBe("16 MiB");
    expect(formatSizeMiB(1023, "en")).toBe("1,023 MiB");
  });

  test("from a gibibyte, in gibibytes, one decimal under ten", () => {
    expect(formatSizeMiB(1024, "en")).toBe("1 GiB");
    expect(formatSizeMiB(1536, "en")).toBe("1.5 GiB");
    expect(formatSizeMiB(40960, "en")).toBe("40 GiB");
    expect(formatSizeMiB(15000, "en")).toBe("15 GiB");
  });

  test("nothing for missing, zero or negative sizes", () => {
    expect(formatSizeMiB(undefined, "en")).toBe("");
    expect(formatSizeMiB(0, "en")).toBe("");
    expect(formatSizeMiB(-5, "en")).toBe("");
  });
});

describe("formatDateTime and formatDate", () => {
  test("format a collector date in the locale", () => {
    expect(formatDateTime(STAMP, "en")).toBe(
      LOCAL.toLocaleString("en", { dateStyle: "short", timeStyle: "medium" }),
    );
    expect(formatDateTime(STAMP, "en")).toMatch(/^9\/15\/26, 3:06:23\sPM$/);
    expect(formatDate(STAMP, "en")).toBe("Sep 15, 2026");
  });

  test("return the raw value when it is not a date, and nothing for none", () => {
    expect(formatDateTime("garbage", "en")).toBe("garbage");
    expect(formatDate("garbage", "en")).toBe("garbage");
    expect(formatDateTime(undefined, "en")).toBe("");
    expect(formatDate("", "en")).toBe("");
  });
});

describe("formatRelativeTime", () => {
  const now = LOCAL.getTime();
  const ago = (seconds: number) => {
    const d = new Date(now - seconds * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  test.each([
    [0, "now"],
    [5, "5 seconds ago"],
    [90, "1 minute ago"],
    [119, "1 minute ago"],
    [3 * 3600 + 59 * 60, "3 hours ago"],
    [24 * 3600, "yesterday"],
    [3 * 24 * 3600, "3 days ago"],
    [8 * 24 * 3600, "last week"],
    [45 * 24 * 3600, "last month"],
    [400 * 24 * 3600, "last year"],
    [-120, "in 2 minutes"],
  ])("%i seconds before now reads %j, truncated", (seconds, text) => {
    expect(formatRelativeTime(ago(seconds), "en", now)).toBe(text);
  });

  test("returns the raw value when it is not a date", () => {
    expect(formatRelativeTime("garbage", "en", now)).toBe("garbage");
    expect(formatRelativeTime(undefined, "en", now)).toBe("");
  });
});

describe("formatDuration", () => {
  test("keeps the two largest units", () => {
    expect(formatDuration(3 * 86400 + 4 * 3600 + 5 * 60, "en")).toBe("3d 4h");
    expect(formatDuration(12 * 60, "en")).toBe("12m");
    expect(formatDuration(15, "en")).toBe("15s");
    expect(formatDuration(3600 + 30, "en")).toBe("1h 30s");
  });

  test("zero or negative is zero seconds", () => {
    expect(formatDuration(0, "en")).toBe("0s");
    expect(formatDuration(-10, "en")).toBe("0s");
  });
});

describe("formatPercent", () => {
  test("as the locale writes it: no space in English, one before it in French", () => {
    expect(formatPercent(63, "en")).toBe("63.0%");
    expect(formatPercent(63, "fr")).toMatch(/^63,0[\u00a0\u202f]%$/);
    expect(formatPercent(0, "en")).toBe("0.0%");
  });

  test("its decimals always, or at most; a cpu's past a hundred", () => {
    expect(formatPercent(12.3456, "en", 2)).toBe("12.35%");
    expect(formatPercent(12.3456, "en", 0)).toBe("12%");
    expect(formatPercent(50, "en", 1, false)).toBe("50%");
    expect(formatPercent(4.25, "en", 1, false)).toBe("4.3%");
    expect(formatPercent(800, "en")).toBe("800.0%");
  });
});

describe("DateTime", () => {
  test("renders a time element with the calendar icon", () => {
    const { container } = render(<DateTime value={STAMP} locale="en" />);
    const time = container.querySelector("time");
    expect(time).toHaveAttribute("datetime", LOCAL.toISOString());
    expect(time).toHaveTextContent(formatDateTime(STAMP, "en"));
    expect(time?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  test("dateOnly leaves out the time", () => {
    render(<DateTime value={STAMP} locale="en" dateOnly />);
    expect(screen.getByText("Sep 15, 2026")).toBeInTheDocument();
  });

  test("an unreadable value is rendered as text, without icon", () => {
    const { container } = render(<DateTime value="garbage" locale="en" />);
    expect(container).toHaveTextContent("garbage");
    expect(container.querySelector("time")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("RelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 15, 15, 9, 23));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("renders the distance from now, the exact date as tooltip", () => {
    const { container } = render(<RelativeTime value={STAMP} locale="en" />);
    const time = container.querySelector("time");
    expect(time).toHaveTextContent("3 minutes ago");
    expect(time).toHaveAttribute("datetime", LOCAL.toISOString());
  });

  test("an unreadable value is rendered as text", () => {
    const { container } = render(<RelativeTime value="garbage" locale="en" />);
    expect(container).toHaveTextContent("garbage");
    expect(container.querySelector("time")).toBeNull();
  });

  test("an empty value renders nothing", () => {
    const { container } = render(<RelativeTime value={undefined} locale="en" />);
    expect(container).toBeEmptyDOMElement();
  });
});
