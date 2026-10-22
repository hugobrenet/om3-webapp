import { createContext, useContext } from "react";

/**
 * Whether the tables below stack their rows as cards in a narrow window (`Table`):
 * on in the record panels, where a table of many columns has no room; off
 * elsewhere, by default.
 */
export const TableCardsContext = createContext(false);

export function useTableCards(): boolean {
  return useContext(TableCardsContext);
}

/**
 * The title of each column, by its index, from the last header row: a title spans
 * the columns of its cell. The sort arrows are not part of it.
 */
function columnLabels(table: HTMLTableElement): string[] {
  const head = table.tHead?.rows[table.tHead.rows.length - 1];
  const labels: string[] = [];
  for (const cell of head?.cells ?? []) {
    const text = (cell.textContent ?? "").replace(/[▲▼]/g, "").trim();
    for (let i = 0; i < cell.colSpan; i++) labels.push(text);
  }
  return labels;
}

/**
 * Names each body cell after its column (`data-label`), for the card of its row to
 * show it before the value. A cell across several columns, a group line, and a
 * cell of a column with no title are left without one.
 */
export function labelCells(table: HTMLTableElement): void {
  const labels = columnLabels(table);
  for (const body of table.tBodies) {
    for (const row of body.rows) {
      let index = 0;
      for (const cell of row.cells) {
        const label = cell.colSpan === 1 ? labels[index] : undefined;
        if (label) {
          if (cell.dataset.label !== label) cell.dataset.label = label;
        } else if (cell.dataset.label !== undefined) {
          delete cell.dataset.label;
        }
        index += cell.colSpan;
      }
    }
  }
}

/**
 * A table in a narrow window, its rows as cards: the header row hidden, a row a
 * block split from the next by its line, a cell a line of its own, the title of
 * its column before its value. An empty cell takes no line.
 */
export const CARDS = [
  "max-md:block",
  "max-md:[&>thead]:hidden",
  "max-md:[&>tbody]:block",
  "max-md:[&>tbody>tr]:block max-md:[&>tbody>tr]:h-auto max-md:[&>tbody>tr]:py-1.5",
  "max-md:[&>tbody>tr>*]:flex max-md:[&>tbody>tr>*]:flex-wrap max-md:[&>tbody>tr>*]:items-center max-md:[&>tbody>tr>*]:gap-x-2 max-md:[&>tbody>tr>*]:py-0.5 max-md:[&>tbody>tr>*]:whitespace-normal max-md:[&>tbody>tr>*]:break-words",
  "max-md:[&>tbody>tr>td:empty]:hidden",
  "max-md:[&>tbody>tr>[data-label]]:before:w-28 max-md:[&>tbody>tr>[data-label]]:before:shrink-0 max-md:[&>tbody>tr>[data-label]]:before:text-ink-muted max-md:[&>tbody>tr>[data-label]]:before:content-[attr(data-label)]",
].join(" ");
