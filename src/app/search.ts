import type { ObjectKind } from "../ui/components/ObjectIcon";
import { om3ObjectKind } from "../ui/components/ObjectIcon";

/**
 * The global search of the cluster, as oc3 searches the collector, on what the
 * daemon lists: the objects, the namespaces they make up, the nodes and the
 * networks. The daemon has no search of its own: the lists are read when the
 * search opens (`loadIndex`), and searched here, as one types.
 */
export type SearchKind = "object" | "namespace" | "node" | "network";

export const SEARCH_KINDS: readonly SearchKind[] = ["object", "namespace", "node", "network"];

/** An entry of the index: what a result shows, and where choosing it leads. */
export interface SearchEntry {
  kind: SearchKind;
  /** The record it opens: its id for the panel (`peek`), or its name in its list. */
  id: string;
  label: string;
  /** What tells homonyms apart: a namespace, a type, a network range. */
  context: string[];
  /** The status, when the kind has one: "up", "down", "n/a"… */
  status?: string;
}

/** The lists read for the search, a kind that could not be read in `failed`. */
export interface SearchIndex {
  entries: SearchEntry[];
  failed: SearchKind[];
}

export interface SearchGroup {
  kind: SearchKind;
  hits: SearchEntry[];
  /** More entries match than the group shows. */
  more: boolean;
  /** The kind could not be read. */
  error: boolean;
}

/** Hits per kind: a few across every kind, more within one. */
export const LIMIT_ALL = 5;
export const LIMIT_ONE = 20;

/** The icon of a hit: its object kind for an object. */
export function hitIcon(entry: SearchEntry): ObjectKind {
  switch (entry.kind) {
    case "object": {
      const parts = entry.id.split("/");
      return om3ObjectKind(parts.length === 3 ? parts[1] : parts.length === 2 ? parts[0] : undefined);
    }
    case "namespace":
      return "namespace";
    case "node":
      return "node";
    default:
      return "network";
  }
}

/** The icon of a kind, in the scopes and the group headings. */
export const KIND_ICON: Record<SearchKind, ObjectKind> = {
  object: "service",
  namespace: "namespace",
  node: "node",
  network: "network",
};

/**
 * The entries matching the query, grouped by kind in the order of the kinds: the
 * label or the context holding the text, case aside; the ones starting with it
 * first, then by label. Empty for an empty query.
 */
export function search(index: SearchIndex, query: string, scope: SearchKind | "all"): SearchGroup[] {
  const q = query.trim().toLocaleLowerCase();
  if (q === "") return [];
  const limit = scope === "all" ? LIMIT_ALL : LIMIT_ONE;
  const kinds = scope === "all" ? SEARCH_KINDS : [scope];
  return kinds.flatMap((kind): SearchGroup[] => {
    const error = index.failed.includes(kind);
    const matches = index.entries
      .filter((e) => e.kind === kind)
      .filter((e) => e.label.toLocaleLowerCase().includes(q) || e.context.some((c) => c.toLocaleLowerCase().includes(q)))
      .sort((a, b) => {
        const sa = a.label.toLocaleLowerCase().startsWith(q) ? 0 : 1;
        const sb = b.label.toLocaleLowerCase().startsWith(q) ? 0 : 1;
        return sa - sb || a.label.localeCompare(b.label);
      });
    if (matches.length === 0 && !error) return [];
    return [{ kind, hits: matches.slice(0, limit), more: matches.length > limit, error }];
  });
}
