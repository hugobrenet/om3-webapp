import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * The pages of a list, as oc3 pages its lists: so many rows a page, 25, 50 or 100,
 * 50 by default, the page in the URL as the filters are, for a link, a reload or the
 * Back button to show the same rows:
 *
 * - `limit`: the rows a page, absent for the size the view keeps;
 * - `offset`: the first row of the page, absent for the first page.
 *
 * The size chosen is kept for the view, by the browser (oc3 keeps it with the
 * account): the list opens with it the next time.
 */

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_LIMIT = 50;

const storageKey = (view: string) => `om3.pageSize.${view}`;

/** A page size the lists offer, or undefined. */
function pageSize(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return PAGE_SIZES.find((size) => size === n);
}

function savedLimit(view: string): number | undefined {
  try {
    return pageSize(localStorage.getItem(storageKey(view)));
  } catch {
    return undefined;
  }
}

function saveLimit(view: string, limit: number): void {
  try {
    localStorage.setItem(storageKey(view), String(limit));
  } catch {
    // Not remembered: the size holds in the URL until the list is left.
  }
}

export interface Paging {
  /** The first row of the page shown, within the list. */
  offset: number;
  limit: number;
  total: number;
  /** The rows of the page, out of the whole list. */
  page: <T>(rows: T[]) => T[];
  setOffset: (offset: number) => void;
  setLimit: (limit: number) => void;
}

/**
 * The page of a list of `total` rows. An offset past the end, from a link or rows
 * gone meanwhile, shows the last page; one between two pages, the page holding it.
 */
export function usePaging(view: string, total: number): Paging {
  const [params, setParams] = useSearchParams();
  const limit = pageSize(params.get("limit")) ?? savedLimit(view) ?? DEFAULT_LIMIT;
  const asked = Math.max(0, Math.floor(Number(params.get("offset")) || 0));
  const lastOffset = total > 0 ? Math.floor((total - 1) / limit) * limit : 0;
  const offset = Math.min(asked - (asked % limit), lastOffset);

  const setOffset = useCallback(
    (next: number) => {
      setParams(
        (previous) => {
          const out = new URLSearchParams(previous);
          if (next > 0) out.set("offset", String(next));
          else out.delete("offset");
          return out;
        },
        { preventScrollReset: true },
      );
    },
    [setParams],
  );

  // Another size: back to the first page, the rows of the one shown being elsewhere.
  const setLimit = useCallback(
    (next: number) => {
      saveLimit(view, next);
      setParams(
        (previous) => {
          const out = new URLSearchParams(previous);
          out.set("limit", String(next));
          out.delete("offset");
          return out;
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [setParams, view],
  );

  const page = useCallback(<T>(rows: T[]) => rows.slice(offset, offset + limit), [offset, limit]);

  return { offset, limit, total, page, setOffset, setLimit };
}

/**
 * The page of a list in a panel: as `usePaging`, but held by the panel, not the
 * URL, whose `offset` and `limit` are the view's under the panel. The size kept
 * for `view` as the views keep theirs.
 */
export function useLocalPaging(view: string, total: number): Paging {
  const [limit, setLimitState] = useState(() => savedLimit(view) ?? DEFAULT_LIMIT);
  const [asked, setAsked] = useState(0);
  const lastOffset = total > 0 ? Math.floor((total - 1) / limit) * limit : 0;
  const offset = Math.min(asked - (asked % limit), lastOffset);
  const setOffset = useCallback((next: number) => setAsked(Math.max(0, next)), []);
  const setLimit = useCallback(
    (next: number) => {
      saveLimit(view, next);
      setLimitState(next);
      setAsked(0);
    },
    [view],
  );
  const page = useCallback(<T>(rows: T[]) => rows.slice(offset, offset + limit), [offset, limit]);
  return { offset, limit, total, page, setOffset, setLimit };
}
