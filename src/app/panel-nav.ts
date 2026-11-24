import { useEffect, useSyncExternalStore } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { parseStep, stepLabel } from "./peek";

/*
 * The Back and Forward of the panels: from a record to the one shown before it, or
 * after it, as the browser history holds them. Every panel change is a navigation
 * (`panel-search.ts`), a tab changed too: the history steps from tab to tab, these
 * from record to record, the tab left last on each found again.
 *
 * The browser does not tell what its entries hold: each is noted as it is shown, by
 * the position React Router keeps in it (`history.state.idx`), with the record open
 * there. Kept for the tab (sessionStorage), a reload losing none of it. A navigation
 * of its own drops what was ahead, as the browser does.
 */

/** An entry of the history: the record open, as `page|sel|id` or `page|peek|kind:id`, and its name. */
export interface PanelEntry {
  record: string | null;
  label: string;
}

const KEY = "om3.panelNav";
/** The entries kept around the current one, the others dropped. */
const KEPT = 200;

let entries: Record<number, PanelEntry> = load();
let current: number | null = null;
const listeners = new Set<() => void>();

function load(): Record<number, PanelEntry> {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<number, PanelEntry>) : {};
  } catch {
    return {};
  }
}

function save() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Not kept: a reload starts the panels' history afresh.
  }
}

/** The record a location shows in a panel, if any: the row panel of its view, else the record over it. */
export function panelEntryOf(pathname: string, search: string): PanelEntry {
  const params = new URLSearchParams(search);
  const sel = params.get("sel");
  if (sel) return { record: `${pathname}|sel|${sel}`, label: sel };
  const peek = params.get("peek");
  const step = peek ? parseStep(peek) : null;
  if (peek && step) return { record: `${pathname}|peek|${peek}`, label: stepLabel(step) };
  return { record: null, label: "" };
}

/**
 * Notes the entry `index` of the history as showing `entry`; `pushed`, a navigation
 * of its own, drops the entries ahead of it.
 */
export function observePanelEntry(index: number, entry: PanelEntry, pushed: boolean) {
  const next: Record<number, PanelEntry> = {};
  for (const [key, value] of Object.entries(entries)) {
    const at = Number(key);
    if (pushed && at > index) continue;
    if (Math.abs(at - index) > KEPT) continue;
    next[at] = value;
  }
  next[index] = entry;
  entries = next;
  current = index;
  save();
  listeners.forEach((listener) => {
    listener();
  });
}

/** Forgets every entry: a test, or a session ended. */
export function resetPanelNav() {
  entries = {};
  current = null;
  save();
}

/** Where Back goes: the last entry of the record shown before this one, if a record. */
export function backTarget(): number | null {
  if (current === null) return null;
  const here = entries[current];
  if (!here?.record) return null;
  for (let at = current - 1; at >= 0; at -= 1) {
    const entry = entries[at] as PanelEntry | undefined;
    if (entry === undefined) return null;
    if (entry.record === here.record) continue;
    return entry.record ? at : null;
  }
  return null;
}

/** Where Forward goes: the last entry of the record shown after this one, if a record. */
export function forwardTarget(): number | null {
  if (current === null) return null;
  const here = entries[current];
  if (!here?.record) return null;
  let at = current + 1;
  while ((entries[at] as PanelEntry | undefined)?.record === here.record) at += 1;
  const next = entries[at] as PanelEntry | undefined;
  if (!next?.record) return null;
  while ((entries[at + 1] as PanelEntry | undefined)?.record === next.record) at += 1;
  return at;
}

const snapshot = () => {
  const back = backTarget();
  const forward = forwardTarget();
  return `${String(current)}|${String(back)}|${String(forward)}`;
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Notes each entry of the history as the app shows it: mounted once, inside the router. */
export function PanelNavTracker() {
  const location = useLocation();
  const type = useNavigationType();
  useEffect(() => {
    const index = (window.history.state as { idx?: unknown } | null)?.idx;
    if (typeof index !== "number") return;
    observePanelEntry(index, panelEntryOf(location.pathname, location.search), type === "PUSH");
  }, [location.key, location.pathname, location.search, type]);
  return null;
}

/** The Back and Forward of the panels: whether each goes anywhere, to what, and going there. */
export function usePanelNav() {
  useSyncExternalStore(subscribe, snapshot);
  const navigate = useNavigate();
  const back = backTarget();
  const forward = forwardTarget();
  const go = (target: number | null) => {
    if (target === null || current === null) return;
    void navigate(target - current);
  };
  return {
    back: back === null ? null : (entries[back]?.label ?? ""),
    forward: forward === null ? null : (entries[forward]?.label ?? ""),
    goBack: () => {
      go(back);
    },
    goForward: () => {
      go(forward);
    },
  };
}
