/**
 * What `om <path> create` checks and does before it writes an object, for the
 * webapp to create one as `ox` does through the daemon API: the path rules of om3
 * `core/naming`, and the id given to the new object. Keep them in step with
 * `core/naming/path.go` and `core/oxcmd/object_create.go`.
 */


/** The kinds one creates: the cluster object exists with the cluster. */
export const CREATABLE_KINDS = ["svc", "vol", "cfg", "sec", "usr", "nscfg"] as const;
export type CreatableKind = (typeof CREATABLE_KINDS)[number];

/** The name om gives a namespace configuration, whatever is asked. */
export const NSCFG_NAME = "namespace";

/** The kinds that run on the nodes, which have something to provision. */
export const PROVISIONABLE_KINDS: readonly string[] = ["svc", "vol"];

/** Names om keeps for itself: the kinds, and "node". */
const RESERVED_NAMES = ["svc", "vol", "cfg", "sec", "usr", "ccfg", "nscfg", "node"];

const ALNUM = /^[a-z0-9]$/i;
const HOSTNAME_REST = /^[a-z0-9.-]*$/i;

/** RFC 952, as om checks a name or a namespace: 1 to 63 characters, a letter or a digit first. */
function hostnameError(s: string): string | null {
  if (s.length < 1) return "empty";
  if (s.length > 63) return "tooLong";
  if (!ALNUM.test(s[0] ?? "")) return "firstChar";
  if (!HOSTNAME_REST.test(s.slice(1))) return "chars";
  return null;
}

export interface PathErrors {
  /** The key of what is wrong, under `createObject.errors`. */
  namespace?: string;
  name?: string;
}

/** What om would refuse in the path of a new object; empty when it is valid. */
export function pathErrors(namespace: string, kind: string, name: string): PathErrors {
  const errors: PathErrors = {};
  const ns = namespace === "" ? "root" : namespace;
  if (ns !== ns.toLowerCase()) errors.namespace = "uppercase";
  else {
    const e = hostnameError(ns);
    if (e !== null) errors.namespace = e;
  }
  if (kind === "nscfg") return errors;
  if (name !== name.toLowerCase()) errors.name = "uppercase";
  else if (kind === "svc" && ns === "root" && name === NSCFG_NAME) errors.name = "reservedRoot";
  else if (RESERVED_NAMES.includes(name)) errors.name = "reserved";
  else {
    // The slice number of a scaler, "<i>.", is not part of the name checked.
    const e = name === "" ? "empty" : hostnameError(name.replace(/^[0-9.]+/, ""));
    if (e !== null) errors.name = e;
  }
  return errors;
}

/**
 * The path of an object as om writes it, and the daemon keys it: the root
 * namespace left out, and the svc kind with it.
 */
export function objectPath(namespace: string, kind: string, name: string): string {
  const ns = namespace === "" ? "root" : namespace;
  const n = kind === "nscfg" ? NSCFG_NAME : name;
  if (ns !== "root") return `${ns}/${kind}/${n}`;
  return kind === "svc" ? n : `${kind}/${n}`;
}

const SECTION = /^\s*\[([^\]]+)\]\s*$/;
const ID_LINE = /^\s*id\s*=/;

/**
 * The configuration with `id` set to `id` in its DEFAULT section, as om gives each
 * new object an id of its own: the one of a copied object goes. A configuration
 * without a DEFAULT section gets one, first.
 */
export function withId(config: string, id: string): string {
  const lines = config.split("\n");
  const at = lines.findIndex((line) => SECTION.exec(line)?.[1]?.trim() === "DEFAULT");
  if (at === -1) {
    const rest = config.trim() === "" ? "" : `\n${config.replace(/^\n+/, "")}`;
    return `[DEFAULT]\nid = ${id}\n${rest}`;
  }
  let end = lines.findIndex((line, i) => i > at && SECTION.test(line));
  if (end === -1) end = lines.length;
  const kept = lines.filter((line, i) => i <= at || i >= end || !ID_LINE.test(line));
  kept.splice(at + 1, 0, `id = ${id}`);
  return kept.join("\n");
}

/** A random UUID, as om gives a new object; `randomUUID` wants a secure context. */
export const newId = (): string => {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
