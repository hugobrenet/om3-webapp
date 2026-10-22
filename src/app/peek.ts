import { om3ObjectKind, type ObjectKind } from "../ui/components/ObjectIcon";

/**
 * The record opened in the panel over the current view, kept in the URL (`peek`) as
 * `kind:id`, as oc3 does: a reload or a shared link reopen it, and the browser Back
 * button returns to what was on display before. The records shown before it are
 * the panel history, kept by the browser tab (`record-history.ts`).
 */
export interface PeekStep {
  kind: string;
  id: string;
}

/**
 * The kinds of record a panel shows:
 * - `node`: a cluster node, by its name;
 * - `object`: an object, by its path (`ns/kind/name`), its instances shown by
 *   its status board;
 * - `network`: a network, by its name;
 * - `namespace`: the usage of a namespace, by its name;
 * - `instance`: the instance of an object on a node, by `path@node` (`instanceId`);
 * - `resource`: a resource of an object on all its nodes, by `path:rid`, or on
 *   the instance of one node, by `path:rid@node` (`resourceId`).
 */
export type PeekKind = "node" | "object" | "network" | "namespace" | "instance" | "resource";

const PEEK_KINDS: ReadonlySet<string> = new Set<PeekKind>([
  "node",
  "object",
  "network",
  "namespace",
  "instance",
  "resource",
]);

/**
 * The id of a resource of an object: "path:rid" on all its nodes, "path:rid@node"
 * on the instance of `node`; an object path holds no colon, a rid no "@".
 */
export const resourceId = (path: string, rid: string, node?: string) =>
  node === undefined ? `${path}:${rid}` : `${path}:${rid}@${node}`;

/** The object, the resource, and the node of its instance if any, of a resource id. */
export function parseResourceId(id: string): { path: string; rid: string; node?: string } | null {
  const cut = id.indexOf(":");
  if (cut <= 0 || cut === id.length - 1) return null;
  const rest = id.slice(cut + 1);
  const at = rest.lastIndexOf("@");
  if (at === 0 || at === rest.length - 1) return null;
  return at < 0
    ? { path: id.slice(0, cut), rid: rest }
    : { path: id.slice(0, cut), rid: rest.slice(0, at), node: rest.slice(at + 1) };
}

/** The id of the instance of an object on a node: "path@node". */
export const instanceId = (path: string, node: string) => `${path}@${node}`;

/** The object and the node of an instance id; a path holds no "@", a node name neither. */
export function parseInstanceId(id: string): { path: string; node: string } | null {
  const at = id.lastIndexOf("@");
  if (at <= 0 || at === id.length - 1) return null;
  return { path: id.slice(0, at), node: id.slice(at + 1) };
}

/** A step of another kind, from a hand-written URL or an old history, is dropped. */
export function isPeekStep(step: PeekStep): step is PeekStep & { kind: PeekKind } {
  return PEEK_KINDS.has(step.kind) && step.id !== "";
}

/** The id may hold colons: only the first one ends the kind. */
export function parseStep(raw: unknown): PeekStep | null {
  if (typeof raw !== "string") return null;
  const cut = raw.indexOf(":");
  if (cut <= 0 || cut === raw.length - 1) return null;
  const step = { kind: raw.slice(0, cut), id: raw.slice(cut + 1) };
  return isPeekStep(step) ? step : null;
}

export function serialiseStep(step: PeekStep): string {
  return `${step.kind}:${step.id}`;
}

/** The kind of an object path ("ns/kind/name", or a bare name for a root service). */
export function pathKind(path: string): string | undefined {
  const parts = path.split("/");
  return parts.length === 3 ? parts[1] : parts.length === 2 ? parts[0] : undefined;
}

/** The pictogram of a record, the one of its object kind for objects. */
export function stepIcon(step: PeekStep): ObjectKind {
  switch (step.kind) {
    case "node":
      return "node";
    case "object":
      return om3ObjectKind(pathKind(step.id));
    case "network":
      return "network";
    case "namespace":
      return "namespace";
    case "instance":
      return "instance";
    case "resource":
      return "app";
    default:
      return "service";
  }
}

/** The name of a record, as the history and the anchor show it. */
export function stepLabel(step: PeekStep): string {
  return step.id;
}
