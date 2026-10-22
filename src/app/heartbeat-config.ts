/*
 * The configuration of a heartbeat, a `[hb#N]` section of the cluster configuration,
 * as the heartbeat wizard reads and writes it: its keys, the fields of its driver,
 * the operations writing it (PATCH /api/cluster/config), the section they write.
 */

/** The drivers of a heartbeat, its `type`. */
export const HB_TYPES = ["unicast", "multicast", "disk", "relay"] as const;
export type HbType = (typeof HB_TYPES)[number];

/**
 * A field of the wizard: a keyword of the section. `perNode`, one a node, scoped
 * (`addr@n1`): an address the same on every node would not do. `required`, the driver
 * not starting without it.
 */
export interface HbField {
  key: string;
  kind?: "text" | "number" | "bool" | "list";
  perNode?: boolean;
  required?: boolean;
}

/** The fields of every heartbeat, whatever its driver. */
export const COMMON_FIELDS: HbField[] = [{ key: "timeout" }, { key: "interval" }];

/** The fields of each driver, as om3 declares its keywords. */
export const HB_FIELDS: Record<HbType, HbField[]> = {
  unicast: [{ key: "addr", perNode: true }, { key: "intf" }, { key: "port", kind: "number" }, { key: "nodes", kind: "list" }],
  multicast: [{ key: "addr" }, { key: "intf" }, { key: "port", kind: "number" }],
  disk: [{ key: "dev", required: true }, { key: "max_slots", kind: "number" }],
  relay: [{ key: "relay", required: true }, { key: "username" }, { key: "password" }, { key: "insecure", kind: "bool" }],
};

/** The keys of a section, `key` or `key@scope`, and their values; empty when absent. */
export type HbValues = Record<string, string>;

const HEADER = /^\s*\[([^\]]+)\]\s*$/;
const KEY = /^\s*([^#;=\s][^=]*?)\s*=\s*(.*?)\s*$/;

/** The keys of a section as om3 writes it, its header first; comments left out. */
export function sectionValues(section: string | null): HbValues {
  const values: HbValues = {};
  for (const line of (section ?? "").split("\n")) {
    if (HEADER.test(line)) continue;
    const match = KEY.exec(line);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

/** The heartbeat sections of a configuration file, by name: `hb#1`, `hb#2`… */
export function hbSections(text: string): string[] {
  return text
    .split("\n")
    .map((line) => HEADER.exec(line)?.[1].trim())
    .filter((name): name is string => name !== undefined && /^hb#\S+$/.test(name));
}

/** The name of a new heartbeat: `hb#N`, N above the highest of those numbered. */
export function nextHbName(names: string[]): string {
  const numbers = names.map((name) => Number(/^hb#(\d+)$/.exec(name)?.[1] ?? 0));
  return `hb#${Math.max(0, ...numbers) + 1}`;
}

/** Whether a key, scoped or not, is one of the fields of a driver or of all of them. */
export function isFieldOf(type: HbType, key: string): boolean {
  const base = key.split("@")[0];
  return base === "type" || [...COMMON_FIELDS, ...HB_FIELDS[type]].some((field) => field.key === base);
}

/** The fields of a driver required and left empty. */
export function missingFields(type: HbType, values: HbValues): string[] {
  return HB_FIELDS[type].filter((field) => field.required && !(values[field.key] ?? "").trim()).map((field) => field.key);
}

/**
 * The operations writing a heartbeat: from the keys it had to those the wizard gives.
 * The same driver, its keys changed set, those emptied unset, the others left alone.
 * Another driver, the keys of the former meaning nothing to it: the section deleted
 * first, `rewrite`, then its keys of the new one set.
 */
export function hbOps(name: string, original: HbValues, values: HbValues): { rewrite: boolean; set: string[]; unset: string[] } {
  const type = values.type as HbType;
  const rewrite = Boolean(original.type) && original.type !== type;
  const set: string[] = [];
  const unset: string[] = [];
  for (const [key, raw] of Object.entries(values)) {
    const value = raw.trim();
    if (rewrite && !isFieldOf(type, key)) continue;
    if (value === "") {
      if (!rewrite && key in original) unset.push(`${name}.${key}`);
      continue;
    }
    if (rewrite || original[key] !== value) set.push(`${name}.${key}=${value}`);
  }
  // The type first, the driver read before its keys.
  set.sort((a, b) => Number(!a.startsWith(`${name}.type=`)) - Number(!b.startsWith(`${name}.type=`)));
  return { rewrite, set, unset };
}

/** The section as it will read once written: its header, its type, then its keys set. */
export function hbPreview(name: string, original: HbValues, values: HbValues): string {
  const type = values.type as HbType;
  const { rewrite } = hbOps(name, original, values);
  const keys = Object.entries(values)
    .filter(([key, value]) => value.trim() !== "" && (!rewrite || isFieldOf(type, key)))
    .sort(([a], [b]) => (a === "type" ? -1 : b === "type" ? 1 : a.localeCompare(b)));
  return [`[${name}]`, ...keys.map(([key, value]) => `${key} = ${value.trim()}`)].join("\n");
}
