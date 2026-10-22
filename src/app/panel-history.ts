import { useEffect, useState, useSyncExternalStore } from "react";
import type { ObjectKind } from "../ui/components/ObjectIcon";
import { isPeekStep, pathKind, serialiseStep, stepIcon, stepLabel, type PeekKind, type PeekStep } from "./peek";
import { useRecordHistory } from "./record-history";

/** The key of the record a panel shows, as the history names it; empty without an id. */
export function recordKey(kind: string, recordId: string | undefined): string {
  return recordId === undefined || recordId === "" ? "" : serialiseStep({ kind, id: recordId });
}

/**
 * The sections of the history, by how long ago a record was shown, and the age each
 * ends at. A record older than the last one is no longer in the history.
 */
const SECTIONS = [
  ["now", 5 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["week", 7 * 24 * 60 * 60 * 1000],
] as const;

export type HistorySection = (typeof SECTIONS)[number][0];

export function sectionOf(age: number): HistorySection {
  return SECTIONS.find(([, limit]) => age < limit)?.[0] ?? "week";
}

/**
 * The types of record, in the order the history groups them by type: the nodes,
 * the object kinds as om3 lists them, the instances, the resources, then the networks and the namespaces.
 */
const TYPES = ["node", "svc", "vol", "cfg", "sec", "usr", "nscfg", "ccfg", "instance", "resource", "network", "namespace"] as const;

export type HistoryType = (typeof TYPES)[number];

/** The type of a record: its object kind for an object, a root service by its bare name. */
export function typeOf(step: PeekStep): HistoryType {
  if (step.kind === "node" || step.kind === "network" || step.kind === "namespace" || step.kind === "instance" || step.kind === "resource") {
    return step.kind;
  }
  if (step.kind !== "object") return "namespace";
  const kind = pathKind(step.id) ?? (step.id === "cluster" ? "ccfg" : "svc");
  return (TYPES as readonly string[]).includes(kind) ? (kind as HistoryType) : "svc";
}

/** How the history is grouped: by how long ago a record was shown, or by its kind. */
export type HistoryGrouping = "time" | "kind";

const GROUPING_KEY = "om3.panelHistory.grouping";
const groupingListeners = new Set<() => void>();

function readGrouping(): HistoryGrouping {
  try {
    return localStorage.getItem(GROUPING_KEY) === "kind" ? "kind" : "time";
  } catch {
    return "time";
  }
}

let grouping: HistoryGrouping = readGrouping();

/** Groups the history so, in every panel showing it, and remembers it in this browser. */
export function setHistoryGrouping(next: HistoryGrouping): void {
  grouping = next;
  try {
    localStorage.setItem(GROUPING_KEY, next);
  } catch {
    // Not remembered: the choice holds until the page is reloaded.
  }
  groupingListeners.forEach((listener) => {
    listener();
  });
}

/** The grouping of the history, and what changes it. */
export function useHistoryGrouping(): { value: HistoryGrouping; set: (next: HistoryGrouping) => void } {
  const value = useSyncExternalStore(
    (listener) => {
      groupingListeners.add(listener);
      return () => groupingListeners.delete(listener);
    },
    () => grouping,
  );
  return { value, set: setHistoryGrouping };
}

/** How often the sections are worked out again while the history is on screen. */
const TICK_MS = 30 * 1000;

/** The time it is, refreshed every `TICK_MS`: records age from a section to the next. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  return now;
}

/** An entry of the history, as the search palette proposes it. */
export interface HistoryEntry {
  key: string;
  step: PeekStep & { kind: PeekKind };
  icon: ObjectKind;
  label: string;
  /** The record the panel displays. */
  current: boolean;
  section: HistorySection;
  type: HistoryType;
  /** When the record was last shown, in milliseconds since the epoch. */
  at: number;
}

/**
 * A group of the history: a time period, or a kind of record, by the grouping
 * chosen. `key` is unique among the groups of either grouping.
 */
export type HistoryGroup =
  | { key: string; by: "time"; section: HistorySection; entries: HistoryEntry[] }
  | { key: string; by: "kind"; kind: HistoryType; icon: ObjectKind; entries: HistoryEntry[] };

/**
 * The panel history, ready to be shown: the records displayed in this browser tab
 * during the last week, the most recently shown first, grouped by how long ago they
 * were shown or, with `grouping` "kind", by kind of record in the order of om3 —
 * only the groups that hold a record — and what removes one or clears them all.
 * One is opened as any record (`usePeek`), and comes back in front.
 */
export function usePanelHistory(currentKey: string, grouping: HistoryGrouping = "time") {
  const history = useRecordHistory();
  const now = useNow();
  const entries: HistoryEntry[] = history.entries.flatMap((record) => {
    const step = { kind: record.kind, id: record.id };
    if (!isPeekStep(step)) return [];
    const key = serialiseStep(step);
    return [
      {
        key,
        step,
        icon: stepIcon(step),
        label: stepLabel(step),
        current: key === currentKey,
        // A clock set back would give a negative age: such a record is of now.
        section: sectionOf(Math.max(0, now - record.at)),
        type: typeOf(step),
        at: record.at,
      },
    ];
  });
  // The entries keep their order, the most recently shown first, within each group.
  const groups: HistoryGroup[] =
    grouping === "kind"
      ? TYPES.map((kind) => {
          const of = entries.filter((entry) => entry.type === kind);
          return { key: `kind-${kind}`, by: "kind" as const, kind, icon: of[0]?.icon ?? "service", entries: of };
        }).filter((group) => group.entries.length > 0)
      : SECTIONS.map(([section]) => ({
          key: `time-${section}`,
          by: "time" as const,
          section,
          entries: entries.filter((entry) => entry.section === section),
        })).filter((group) => group.entries.length > 0);
  return {
    entries,
    groups,
    remove: (entry: HistoryEntry) => {
      history.remove(entry.step.kind, entry.step.id);
    },
    clear: history.clear,
  };
}
