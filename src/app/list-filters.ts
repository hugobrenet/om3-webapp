import { useEffect } from "react";
import { create } from "zustand";
import { parseCount, STATE_FIELDS } from "./object-facets";
import { DOWN_REASONS } from "./resource-lines";
import { MAX_VALUE_BYTES } from "./interface-context";

/**
 * The filters of the list on display, for the context of a question to the assistant
 * (`interface-context.ts`): what "these services" or "those down" are. Told by the page
 * itself, as it applies them (`useShareListFilters`), as it tells the rows ticked
 * (`checked-rows.ts`): what the model reads is what the list keeps, whether the filter
 * came from the address, from a click, or from words typed.
 *
 * Said in words, as the agent's `list filters` are: what the list holds, then a filter
 * each, `avail is down or warn`, `avail is not any of down, warn`, `up instances is at
 * least 1`, `path contains web`, separated by `; `. A filter may come from a link someone
 * else wrote: only the values each list declares go (`LISTS`), those of closed values,
 * and of the others those the list offers, the values its rows have, shaped as a name,
 * a few. A value left out, a filter no list declares, or an entry too long for the agent
 * is said so, `other filters not listed`: the list on display is narrower than told, and
 * the model is never told a wider set.
 */
export type ListName = "objects" | "resources" | "nodes" | "heartbeats";

/** The filters a list applies, by its own keys. */
export interface AppliedFilters {
  /** The tab of the list on display, of those the list declares. */
  tab?: string;
  /** The values chosen of each field, by its key: those of none chosen keep every row. */
  chosen?: Readonly<Record<string, readonly string[]>>;
  /** The keys of the fields reversed: the rows of none of their values chosen kept. */
  reversed?: readonly string[];
  /** A count typed in for a field, as `>= 1` (parseCount), by its key. */
  counts?: Readonly<Record<string, string>>;
  /** The keys of the switches on, as Problems only. */
  flags?: readonly string[];
  /** The words searched, as the list searches them, by the key of the search. */
  contains?: Readonly<Record<string, string>>;
  /**
   * The values the rows of the list have, of each field of open values: those chosen of
   * none of them keep no row, and a link names no other.
   */
  offered?: Readonly<Record<string, readonly string[]>>;
}

export interface SharedListFilters {
  list: ListName;
  applied: AppliedFilters;
}

/** What a field of a list is: its words, and its values, those of a list or shaped. */
interface FieldRule {
  word: string;
  values: readonly string[] | RegExp;
  /** Past this many values chosen, their count is said instead. */
  max?: number;
  /** The words of a value its own name does not tell. */
  labels?: Readonly<Record<string, string>>;
  /** The filter said in a sentence of its own, of the words of its values, rather than `word is …`. */
  says?: (values: readonly string[]) => string;
}

interface ListRule {
  /** What the list holds, by its tab; `default` without a tab, or of a tab not declared. */
  holds: Readonly<Record<string, string>>;
  fields: Readonly<Record<string, FieldRule>>;
  counts?: Readonly<Record<string, string>>;
  flags?: Readonly<Record<string, string>>;
  contains?: Readonly<Record<string, string>>;
}

/** A name, as of a node, a namespace, a driver group or an environment: short and with no space. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** A namespace, as om names them. */
const NAMESPACE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
/** A version of the agent, as 3.0.0-rc71. */
const VERSION = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/;
/** A label of a node, its key or `key=value`. */
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,62}(=[A-Za-z0-9._/:@-]{0,127})?$/;
/** Words searched: a part of a name, short and with no space. */
const SEARCHED = /^[A-Za-z0-9._/:@#-]{1,64}$/;
/** The kinds of objects, which the kind filter of All offers. */
const KINDS = ["svc", "vol", "cfg", "sec", "usr", "ccfg", "nscfg"];
/** The states of a resource, as om says them. */
const RESOURCE_STATES = ["up", "down", "warn", "stdby up", "stdby down", "n/a", "undef"];
/** Past them, the values chosen of a field of open values are given by their count. */
const MAX_LISTED_VALUES = 5;
/** Told when a filter applied is not given: the list is narrower than said. */
export const NOT_LISTED = "other filters not listed";

/** The names of the fields of the State and Config filters, as the tools of the agent give them. */
const STATE_WORDS: Readonly<Record<string, string>> = { config_validation: "config validation" };

/** The lists that tell their filters, and what each of their filters is. */
export const LISTS: Readonly<Record<ListName, ListRule>> = {
  objects: {
    holds: {
      default: "objects",
      any: "objects of all kinds",
      services: "services",
      volumes: "volumes",
      configs: "configs",
      secrets: "secrets",
      users: "users",
    },
    fields: {
      ...Object.fromEntries(
        (STATE_FIELDS as { key: string; order: string[] }[]).map(({ key, order }) => [key, { word: STATE_WORDS[key] ?? key, values: order }]),
      ),
      namespace: { word: "namespace", values: NAMESPACE, max: MAX_LISTED_VALUES },
      kind: { word: "kind", values: KINDS },
    },
    counts: { up: "up instances" },
    contains: { name: "path contains" },
  },
  resources: {
    holds: { default: "resources" },
    fields: {
      status: { word: "status", values: RESOURCE_STATES },
      node: { word: "node", values: NAME, max: MAX_LISTED_VALUES },
      group: { word: "driver group", values: NAME, max: MAX_LISTED_VALUES },
      // A reason is the webapp's (quietReason), of a resource down only: said so, the
      // model reading `reason is optional` as a filter optional, not applied.
      reason: {
        word: "down reason",
        values: DOWN_REASONS,
        labels: {
          optional: "because the resource is optional",
          disabled: "because the resource is disabled",
          stopped: "because its instance was stopped on purpose",
          passive: "because its node is passive, its object up on another",
          unused: "because its volume is used by nothing",
          none: "for no reason the webapp excuses, a problem",
        },
        // One clause: "down resources only, down because …" read as two filters, the
        // resources down and those optional, a wider set.
        says: (values) => `only the resources down ${values.join(" or ")}, as the webapp tells it`,
      },
    },
    flags: { problems: "problems only, as the webapp tells them: in warn, or down and neither optional, disabled, stopped, passive nor unused" },
    contains: { text: "object, rid, type, label or node contains" },
  },
  nodes: {
    holds: { default: "nodes" },
    fields: {
      state: { word: "state", values: NAME, max: MAX_LISTED_VALUES },
      frozen: { word: "frozen", values: ["frozen", "thawed"] },
      env: { word: "env", values: NAME, max: MAX_LISTED_VALUES },
      version: { word: "agent version", values: VERSION, max: MAX_LISTED_VALUES },
      label: { word: "label", values: LABEL, max: MAX_LISTED_VALUES },
    },
    contains: { name: "name contains" },
  },
  heartbeats: {
    holds: { default: "heartbeat streams" },
    fields: {
      state: { word: "state", values: NAME, max: MAX_LISTED_VALUES },
      status: { word: "status", values: ["beating", "stale"] },
      node: { word: "node", values: NAME, max: MAX_LISTED_VALUES },
      id: { word: "heartbeat", values: NAME, max: MAX_LISTED_VALUES },
      type: { word: "type", values: NAME, max: MAX_LISTED_VALUES },
    },
  },
};

/** A comparison typed in for a count (parseCount), in words. */
const COMPARISONS: Readonly<Record<string, string>> = { "=": "is", "<": "is less than", "<=": "is at most", ">": "is more than", ">=": "is at least" };
/** Past it, a count typed in is not one. */
const MAX_COUNT = 9999;

const bytes = (text: string) => new TextEncoder().encode(text).length;

/** The value of `record` at `key`, its own, never of its prototype. */
const own = <T,>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined =>
  record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;

/** A field holding `values`, in words: `avail is down or warn`, reversed `avail is not any of down, warn`. */
function holds(word: string, values: readonly string[], reversed: boolean): string {
  if (!reversed) return `${word} is ${values.join(" or ")}`;
  return values.length === 1 ? `${word} is not ${values[0]}` : `${word} is not any of ${values.join(", ")}`;
}

/**
 * The entry of the filters of the list on display, or none: no filter and its tab of
 * its own. A value, a filter or a list not declared, or an entry too long, said so.
 */
export function listFiltersEntry(shared: SharedListFilters | null | undefined): { description: string; value: string }[] {
  if (!shared) return [];
  const rule = own(LISTS, shared.list);
  if (!rule) return [];
  const { tab, chosen = {}, reversed = [], counts = {}, flags = [], contains = {}, offered = {} } = shared.applied;
  const declaredTab = tab !== undefined ? own(rule.holds, tab) : undefined;
  const what = declaredTab ?? own(rule.holds, "default") ?? shared.list;
  const filters: string[] = [];
  let unlisted = tab !== undefined && declaredTab === undefined;
  for (const [key, values] of Object.entries(chosen)) {
    if (values.length > 0 && own(rule.fields, key) === undefined) unlisted = true;
  }
  for (const [key, field] of Object.entries(rule.fields)) {
    const all = [...new Set(own(chosen, key) ?? [])];
    let kept = all.filter((value) => (Array.isArray(field.values) ? field.values.includes(value) : (field.values as RegExp).test(value)));
    if (kept.length < all.length) unlisted = true;
    // Of open values, those the rows have: another keeps no row, and is no word to say.
    const present = Array.isArray(field.values) ? undefined : own(offered, key);
    if (present !== undefined) {
      const some = kept.filter((value) => present.includes(value));
      if (some.length === 0 && kept.length > 0) unlisted = true;
      kept = some;
    }
    if (kept.length === 0) continue;
    if (field.max !== undefined && kept.length > field.max) filters.push(`${field.word} is one of ${kept.length} values`);
    else {
      const words = kept.map((value) => own(field.labels, value) ?? value);
      filters.push(field.says ? field.says(words) : holds(field.word, words, reversed.includes(key)));
    }
  }
  for (const key of flags) {
    const word = own(rule.flags, key);
    if (word === undefined) unlisted = true;
    else filters.push(word);
  }
  for (const [key, typed] of Object.entries(counts)) {
    const comparison = parseCount(typed) as { op: string; value: number } | null | undefined;
    if (comparison === null || comparison === undefined) continue;
    const word = own(rule.counts, key);
    if (word === undefined || comparison.value > MAX_COUNT) unlisted = true;
    else filters.push(`${word} ${COMPARISONS[comparison.op]} ${comparison.value}`);
  }
  for (const [key, searched] of Object.entries(contains)) {
    if (searched === "") continue;
    const word = own(rule.contains, key);
    // Searched in any case, as the lists search.
    if (word === undefined || !SEARCHED.test(searched)) unlisted = true;
    else filters.push(`${word} ${searched.toLowerCase()}`);
  }
  if (unlisted) filters.push(NOT_LISTED);
  // A list of tabs says the one on display, its own too: no entry would read as every object.
  if (filters.length === 0 && tab === undefined) return [];
  const value = [what, ...filters].join("; ");
  // Too long for the agent, the entry would be left out, and the list read as not filtered.
  if (bytes(value) > MAX_VALUE_BYTES) return [{ description: "list filters", value: `${what}; ${NOT_LISTED}` }];
  return [{ description: "list filters", value }];
}

const useListFilters = create<{ shared: SharedListFilters | null }>(() => ({ shared: null }));

/** The filters of the list on display, `null` when none tells them. */
export const listFilters = (): SharedListFilters | null => useListFilters.getState().shared;

/**
 * Tells the filters a list applies, `applied` the same object while they do not
 * change (useMemo); none once the list leaves the page.
 */
export function useShareListFilters(list: ListName, applied: AppliedFilters | null): void {
  useEffect(() => {
    const shared = applied === null ? null : { list, applied };
    useListFilters.setState({ shared });
    return () => {
      if (useListFilters.getState().shared === shared) useListFilters.setState({ shared: null });
    };
  }, [list, applied]);
}
