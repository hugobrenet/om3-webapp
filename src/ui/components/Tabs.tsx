import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface TabItem {
  key: string;
  label: string;
  icon?: ReactNode;
  /** Small count after the label, for example the number of rows in the tab. */
  badge?: ReactNode;
}

/**
 * Tab bar following the ARIA "tabs" pattern: a single tab in the Tab order, and the
 * arrows, Home and End move from one tab to the next and activate it.
 *
 * It scrolls horizontally when the tabs no longer fit: their number can grow without
 * breaking the layout.
 */
export function TabList({
  tabs,
  active,
  onChange,
  label,
  idPrefix,
}: {
  tabs: TabItem[];
  active: string;
  onChange: (key: string) => void;
  /** Accessible name of the tab bar. */
  label: string;
  /** Prefix of the ids, shared with `tabPanelProps`. */
  idPrefix: string;
}) {
  const list = useRef<HTMLDivElement>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.key === active);
    const target =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : -1;
    const next = tabs[target];
    if (next === undefined) return;
    event.preventDefault();
    onChange(next.key);
    list.current
      ?.querySelector<HTMLElement>(`#${CSS.escape(`${idPrefix}-tab-${next.key}`)}`)
      ?.focus();
  }

  return (
    <div
      ref={list}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      // The bottom line is an inner shadow rather than a border: the underline of the
      // active tab covers it without overflowing by a pixel, which used to bring up a
      // vertical scrollbar. Only horizontal scrolling stays allowed.
      className="flex shrink-0 gap-1 overflow-x-auto overflow-y-hidden px-3 shadow-[inset_0_-1px_0_var(--color-line)]"
    >
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <button
            key={tab.key}
            id={`${idPrefix}-tab-${tab.key}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${tab.key}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onChange(tab.key);
            }}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-2 py-2 whitespace-nowrap ${
              selected
                ? "border-accent font-medium text-ink"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.badge}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A count in the name of a tab, as a small badge after its label: how many rows the
 * tab holds. Part of the tab's accessible name ("Services 6").
 */
export function TabCount({ count }: { count: number }) {
  return (
    <span className="min-w-[2ch] rounded-full bg-surface-sunken px-1.5 text-center text-data leading-snug font-normal text-ink-muted tabular-nums">
      {count}
    </span>
  );
}
