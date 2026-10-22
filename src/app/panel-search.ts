import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { parseStep, serialiseStep, type PeekStep } from "./peek";

/**
 * Panel state of a view, in the URL as oc3 keeps it, so that a link, a reload or the
 * Back button reopen the same panel on the same tab:
 *
 * - `sel`: the row of the view whose detail panel is open;
 * - `tab`: the tab open in that panel, absent for its first one;
 * - `peek`: a record looked at without leaving the view, as `kind:id` (`peek.ts`),
 *   from a badge, the panel history or the anchor, whatever the view;
 * - `peektab`: the tab open in that panel.
 *
 * One drawer at a time: opening the row panel closes the record a badge had opened,
 * and the other way round. Should a hand-written URL carry both, the row panel wins.
 * The other parameters of the view (its filters) are left as they are.
 */
export interface PanelUpdate {
  sel?: string;
  tab?: string;
  peek?: string;
  peektab?: string;
  /** A view within the tab shown: the part of a long tab on display. */
  view?: string;
}

export const PANEL_KEYS = ["sel", "tab", "peek", "peektab", "view"] as const;

/**
 * The URL parameters after an update. A key present with `undefined` clears it; an
 * absent key leaves it, except for the drawer the update closes.
 */
export function applyPanelUpdate(previous: URLSearchParams, next: PanelUpdate): URLSearchParams {
  const out = new URLSearchParams(previous);
  const values: PanelUpdate = { ...next };
  if ("sel" in next) {
    values.peek = undefined;
    values.peektab = undefined;
    if (!("tab" in next)) values.tab = undefined;
  }
  if ("peek" in next) {
    values.sel = undefined;
    values.tab = undefined;
    if (!("peektab" in next)) values.peektab = undefined;
  }
  // The view within a tab, its daemon's executions say: another record or tab, its own.
  if (["sel", "tab", "peek", "peektab"].some((key) => key in next) && !("view" in next)) values.view = undefined;
  for (const key of PANEL_KEYS) {
    if (!(key in values)) continue;
    const value = values[key];
    if (value === undefined || value === "") out.delete(key);
    else out.set(key, value);
  }
  return out;
}

/** A non-empty parameter, `undefined` otherwise. */
function read(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key);
  return value === null || value === "" ? undefined : value;
}

/**
 * The panel state of the URL, and what changes it. Each change is a navigation of its
 * own, which the Back button undoes, and keeps the scroll of the view: the list must
 * not jump under the panel.
 */
export function usePanelSearch() {
  const [params, setParams] = useSearchParams();
  const sel = read(params, "sel");
  const tab = read(params, "tab");
  const rawPeek = read(params, "peek");
  const peektab = read(params, "peektab");
  const view = read(params, "view");
  const peek = useMemo(
    () => (sel !== undefined ? null : parseStep(rawPeek)),
    [sel, rawPeek],
  );

  const update = useCallback(
    (next: PanelUpdate) => {
      setParams((previous) => applyPanelUpdate(previous, next), { preventScrollReset: true });
    },
    [setParams],
  );

  return {
    sel,
    tab,
    peek,
    peektab,
    view,
    update,
    /** Shows a view within the tab, `undefined` its first one: Back returns to the one before. */
    setView: useCallback((next: string | undefined) => {
      update({ view: next });
    }, [update]),
    /** Opens the detail panel of a row of the view, on its first tab; `undefined` closes it. */
    select: useCallback((id: string | undefined, nextTab?: string) => {
      update({ sel: id, tab: nextTab });
    }, [update]),
    setTab: useCallback((next: string | undefined) => {
      update({ tab: next });
    }, [update]),
    /** Opens a record over the view, on its first tab or the one given. */
    openPeek: useCallback((step: PeekStep, nextTab?: string) => {
      update({ peek: serialiseStep(step), peektab: nextTab });
    }, [update]),
    setPeekTab: useCallback((next: string | undefined) => {
      update({ peektab: next });
    }, [update]),
    closePeek: useCallback(() => {
      update({ peek: undefined, peektab: undefined });
    }, [update]),
  };
}

/**
 * Opens the record of an object over whatever view is on display (see `PeekPanel`).
 * Shared by every badge naming a record, by the panel history and by the anchor,
 * so that they all behave alike.
 */
export function usePeek() {
  const { openPeek } = usePanelSearch();
  return useCallback(
    (kind: string, id: string, tab?: string) => {
      openPeek({ kind, id }, tab);
    },
    [openPeek],
  );
}
