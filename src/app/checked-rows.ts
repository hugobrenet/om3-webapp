import { useEffect } from "react";
import { create } from "zustand";

/**
 * The rows ticked in the list on display, for the context of a question to the
 * assistant (`interface-context.ts`): "why are these in warn?" names nothing. Held
 * by the page, never by its address: a link cannot tick a row.
 */
export type CheckedKind = "objects" | "nodes" | "resources";

export interface CheckedRows {
  kind: CheckedKind;
  /** The identifiers of the rows, in the order of the list. */
  ids: readonly string[];
}

const useCheckedRows = create<{ checked: CheckedRows | null }>(() => ({ checked: null }));

/** The rows ticked in the list on display, `null` when none. */
export const checkedRows = (): CheckedRows | null => useCheckedRows.getState().checked;

/**
 * Tells the rows a list ticks, `ids` the identifiers of its selection: none once
 * it is cleared or the list leaves the page.
 */
export function useShareCheckedRows(kind: CheckedKind, ids: readonly string[]): void {
  useEffect(() => {
    const shared = ids.length === 0 ? null : { kind, ids };
    useCheckedRows.setState({ checked: shared });
    return () => {
      if (useCheckedRows.getState().checked === shared) useCheckedRows.setState({ checked: null });
    };
  }, [kind, ids]);
}
