import { useSyncExternalStore } from "react";
import type { PeekStep } from "./peek";

/**
 * The records last shown in a panel, kept for the lifetime of the browser tab, as
 * oc3 keeps them: each tab has its own history, what this window went through, and
 * it is gone with the tab. Two tabs open on two subjects do not mix their histories.
 *
 * The storage names the user it belongs to: someone else signing in from the same
 * tab starts from an empty history.
 */

/** A record of the history: what was shown, and when it last was. */
export interface HistoryRecord {
  kind: string;
  id: string;
  /** Milliseconds since the epoch. */
  at: number;
}

const STORAGE_KEY = "om3.history";
const LAST_KEY = "om3.last-record";

/** Records kept; the history zone of the panel scrolls when they do not all fit. */
export const HISTORY_SIZE = 30;

/** A record not shown for this long leaves the history. */
const HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** A record shown again this soon keeps its time: nothing worth a write. */
const HISTORY_RETOUCH_MS = 60 * 1000;

interface Stored {
  user: string;
  records: HistoryRecord[];
}

const EMPTY: Stored = { user: "", records: [] };

/**
 * The user the history belongs to: the subject of the access token, whichever way
 * it was obtained (cluster login or OpenID). Empty when there is none to read.
 */
export function currentUser(): string {
  try {
    const token = localStorage.getItem("authToken");
    const payload = token?.split(".")[1];
    if (payload === undefined) return "";
    const claims: unknown = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof claims !== "object" || claims === null) return "";
    const { sub, preferred_username: name } = claims as Record<string, unknown>;
    return typeof name === "string" ? name : typeof sub === "string" ? sub : "";
  } catch {
    return "";
  }
}

function read(): Stored {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null");
    if (typeof raw !== "object" || raw === null) return EMPTY;
    const { user, records } = raw as Record<string, unknown>;
    if (typeof user !== "string" || !Array.isArray(records)) return EMPTY;
    return {
      user,
      records: records.flatMap((e: unknown): HistoryRecord[] => {
        if (typeof e !== "object" || e === null) return [];
        const { kind, id, at } = e as Record<string, unknown>;
        return typeof kind === "string" && typeof id === "string" && typeof at === "number"
          ? [{ kind, id, at }]
          : [];
      }),
    };
  } catch {
    // Storage refused or unreadable: the history starts empty.
    return EMPTY;
  }
}

let stored = read();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function write(next: Stored) {
  stored = next;
  for (const listener of listeners) listener();
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Not kept: the history still holds until the page is reloaded.
  }
}

/** Forgets the history held in memory: the storage is read again. For the tests. */
export function reloadRecordHistory(): void {
  stored = read();
  for (const listener of listeners) listener();
}

/**
 * The history of a user, the most recently shown first, without the records shown
 * more than a week before `now` nor those beyond `HISTORY_SIZE`.
 */
function current(user: string, now: number): HistoryRecord[] {
  if (stored.user !== user) return [];
  return stored.records
    .filter((record) => now - record.at < HISTORY_MAX_AGE_MS)
    .sort((a, b) => b.at - a.at)
    .slice(0, HISTORY_SIZE);
}

/**
 * The records last shown in a panel by the signed-in user in this tab, the most
 * recently shown first, and what records one, removes one or clears them.
 */
export function useRecordHistory() {
  useSyncExternalStore(subscribe, () => stored);
  const user = currentUser();
  const entries = current(user, Date.now());
  const other = (kind: string, id: string) => (e: HistoryRecord) => e.kind !== kind || e.id !== id;
  return {
    entries,
    /**
     * Notes that a record is shown. It enters the history with the time it is, or,
     * already listed, takes that time and so comes back in front. With `touch`
     * false, a record already listed keeps its time and its place: what a record
     * picked in the history itself asks for, so that the list does not move under
     * the pointer.
     */
    record: (kind: string, id: string, touch = true) => {
      const now = Date.now();
      const records = current(user, now);
      const listed = records.find((e) => e.kind === kind && e.id === id);
      if (listed !== undefined && (!touch || now - listed.at < HISTORY_RETOUCH_MS)) return;
      write({
        user,
        records: [{ kind, id, at: now }, ...records.filter(other(kind, id))].slice(0, HISTORY_SIZE),
      });
    },
    remove: (kind: string, id: string) => {
      write({ user, records: current(user, Date.now()).filter(other(kind, id)) });
    },
    clear: () => {
      write({ user, records: [] });
    },
  };
}

/**
 * The record a panel showed last, for the anchor that reopens the panels once
 * closed (`PanelAnchor`): the history cannot tell, a record shown again keeping its
 * place in it. Kept by the browser tab, like the history.
 */
export function rememberLastRecord(step: PeekStep): void {
  try {
    sessionStorage.setItem(LAST_KEY, JSON.stringify({ kind: step.kind, id: step.id }));
  } catch {
    // Not kept: the anchor falls back on the first record of the history.
  }
}

export function readLastRecord(): PeekStep | null {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(LAST_KEY) ?? "null");
    if (typeof raw !== "object" || raw === null) return null;
    const { kind, id } = raw as Record<string, unknown>;
    return typeof kind === "string" && typeof id === "string" ? { kind, id } : null;
  } catch {
    return null;
  }
}
