import type {
  HTMLAttributes,
  Ref,
  KeyboardEvent,
  ReactNode,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";
import { useLayoutEffect, useRef } from "react";
import { cn } from "../cn";
import { CARDS, labelCells, useTableCards } from "./table-cards";

/**
 * The list table of oc3 (`CollectorList`): a raised panel with a line border,
 * 13px text, header in muted ink, rows split by a line and darkened on hover.
 * Rows are 30px high (`h-[1.875rem]`), as in the views still on MUI.
 *
 * `sticky` keeps the header in view: the wrapper then scrolls both ways, so it must
 * be given a bounded height by its page (`min-h-0 flex-1` in a flex column filling
 * the view, or a `max-h-*`). Without one it grows with its rows and nothing scrolls
 * in it.
 *
 * `aria-label` names the table itself, not its wrapper.
 *
 * `cards` stacks its rows as cards in a narrow window, each value after the title
 * of its column (`table-cards`); by default, as its place says: on in a record panel.
 * A table whose layout carries meaning, as a status board, keeps its columns.
 */
export function Table({
  sticky = false,
  className,
  tableClassName,
  cards: cardsProp,
  "aria-label": label,
  ref,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  /** The scrolling container, for views that load more rows on scroll. */
  ref?: Ref<HTMLDivElement>;
  sticky?: boolean;
  tableClassName?: string;
  cards?: boolean;
  children: ReactNode;
}) {
  const cardsInPlace = useTableCards();
  const cards = cardsProp ?? cardsInPlace;
  const table = useRef<HTMLTableElement>(null);
  // The cells named after their columns, as the rows come and go.
  useLayoutEffect(() => {
    const element = table.current;
    if (!cards || element === null) return;
    labelCells(element);
    const observer = new MutationObserver(() => {
      labelCells(element);
    });
    observer.observe(element, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
    };
  }, [cards]);
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-(--radius-panel) border border-line bg-surface-raised",
        sticky ? "overflow-auto" : "overflow-x-auto",
        className,
      )}
      {...props}
    >
      <table
        ref={table}
        aria-label={label}
        data-sticky={sticky ? "" : undefined}
        data-cards={cards ? "" : undefined}
        className={cn(
          "w-full border-collapse text-data",
          sticky && "[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-surface-raised",
          cards && CARDS,
          tableClassName,
        )}
      >
        {children}
      </table>
    </div>
  );
}

/** Header row. */
export function HeaderRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-line text-left text-ink-muted", className)} {...props} />;
}

/**
 * Every column is aligned left, its title as its values, whatever they hold: the
 * value starts under the name of its column in all the tables.
 */
const ALIGN = "text-left";

/** Header cell, `scope="col"`. */
export function HeaderCell({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn("h-[1.875rem] px-2 py-1 font-medium whitespace-nowrap", ALIGN, className)}
      {...props}
    />
  );
}

export type SortDirection = "asc" | "desc";

/**
 * Sortable header cell: the whole label is a button, the order shown by an arrow
 * and announced by `aria-sort`, as in oc3. The arrow hangs past the end of the
 * label, so that sorting on a column does not move its title.
 */
export function SortHeaderCell({
  label,
  active,
  direction,
  onSort,
  className,
}: {
  label: ReactNode;
  active: boolean;
  direction: SortDirection;
  onSort: () => void;
  className?: string;
}) {
  return (
    <th
      scope="col"
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className={cn("h-[1.875rem] p-0", ALIGN, className)}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          // The padding of the body cells: the title starts where the values do.
          "w-full px-2 py-1 font-medium whitespace-nowrap hover:text-ink",
          ALIGN,
          active && "text-ink",
        )}
      >
        <span className="relative">
          {label}
          {active && (
            <span aria-hidden="true" className="absolute top-0 left-full pl-1">
              {direction === "asc" ? "▲" : "▼"}
            </span>
          )}
        </span>
      </button>
    </th>
  );
}

/** Checks or unchecks the checkbox of `row`, as a click would: false when it has none to. */
export function toggleCheckbox(row: HTMLElement): boolean {
  const box = row.querySelector<HTMLInputElement>("input[type='checkbox']:not(:disabled)");
  if (box === null) return false;
  box.click();
  return true;
}

/** The next row of `row`'s body that opens something, by `key`: Up, Down, Home or End; null if none. */
function rowBy(row: HTMLElement, key: string): HTMLElement | null {
  const rows = [...(row.parentElement?.querySelectorAll<HTMLElement>(":scope > tr[tabindex='0']") ?? [])];
  const at = rows.indexOf(row);
  switch (key) {
    case "ArrowDown":
      return rows[at + 1] ?? null;
    case "ArrowUp":
      return at > 0 ? (rows[at - 1] ?? null) : null;
    case "Home":
      return rows[0] ?? null;
    case "End":
      return rows[rows.length - 1] ?? null;
    default:
      return null;
  }
}

/**
 * Body row. With `onActivate` the row opens something, by click as by keyboard
 * (Enter; Space too when it has no checkbox): it takes the focus and the pointer,
 * and a click on a control inside a cell must stop its propagation. Space checks or
 * unchecks the checkbox of the row, the one selecting it. Up and Down move the focus
 * to the row before or after, Home and End to the first or the last. `selected`
 * marks the row on display.
 */
export function Row({
  onActivate,
  selected = false,
  className,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & { onActivate?: () => void; selected?: boolean }) {
  const interactive = onActivate !== undefined;
  return (
    <tr
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onActivate : undefined}
      onKeyDown={
        interactive
          ? (event: KeyboardEvent<HTMLTableRowElement>) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === " " && toggleCheckbox(event.currentTarget)) {
                event.preventDefault();
                return;
              }
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onActivate();
                return;
              }
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
              // Handled, past the end too: the page does not scroll under the rows.
              event.preventDefault();
              rowBy(event.currentTarget, event.key)?.focus();
            }
          : undefined
      }
      aria-current={selected ? "true" : undefined}
      className={cn(
        "h-[1.875rem] border-b border-line last:border-b-0 hover:bg-surface-sunken",
        interactive &&
          "cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-ring)",
        selected && "bg-accent-soft",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Body cell, aligned left under its column title. `numeric` marks a number, set in
 * tabular digits so that the figures of a column line up. What the cell holds sits in
 * the middle of the line rather than on its baseline: an inline control (a checkbox,
 * a small button, a mark) would otherwise add the room of a descender under it and
 * make the row taller than the others.
 */
export function Cell({
  numeric = false,
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        "px-2 py-1 [&>*]:align-middle",
        ALIGN,
        numeric && "tabular-nums",
        className,
      )}
      data-numeric={numeric ? "" : undefined}
      {...props}
    />
  );
}

/** The single row of an empty table, or of a table that failed to load. */
export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-2 py-3 text-ink-muted">
        {children}
      </td>
    </tr>
  );
}
