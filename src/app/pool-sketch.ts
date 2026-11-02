/*
 * The sketch of a pool (`sketch-layout.ts`): what it is in a band over the nodes of the
 * cluster, its head, its capabilities and where it takes its volumes from; a box for
 * each node saying what the pool is there, its head and its use as the node reports
 * them; the volumes it made under the boxes, by the nodes holding them, a copy on each
 * for a drbd pool. A volume on several nodes is drawn once, a pill across them; one no
 * service uses, a pill dashed all along.
 */
import { type SketchFact, type SketchInput, type SketchLayout, layoutSketch } from "./sketch-layout";

/** A pool as the pool list gives it, the whole cluster's or a node's. */
export interface SketchPool {
  name: string;
  type: string;
  head?: string;
  size?: number;
  used?: number;
  free?: number;
  capabilities?: string[];
  shared?: boolean;
  node?: string;
}

/** A volume as the pool volume list gives it: its consumers `path@node`, the nodes holding it. */
export interface SketchVolume {
  path: string;
  size?: number;
  children?: string[];
  nodes?: string[];
}

export interface PoolSketchInput {
  pool: SketchPool;
  /** The pool as each node reports it. */
  perNode: Record<string, SketchPool>;
  /** The keys of its section. */
  values: Record<string, string>;
  nodes: string[];
  volumes: SketchVolume[];
}

/** The keys saying where a pool takes its volumes from, shown when set. */
const SOURCE_KEYS = ["path", "name", "vg", "zpool", "array", "diskgroup", "srp", "rbd_pool", "rbd_namespace", "template", "network", "fs_type"];

/** What the pool is over all the nodes, its band: its head, its capabilities, its source. */
export function poolBandFacts({ pool, values }: Pick<PoolSketchInput, "pool" | "values">): SketchFact[] {
  const facts: SketchFact[] = [];
  if (pool.head) facts.push({ key: "head", value: pool.head });
  for (const key of SOURCE_KEYS) {
    // The head says the path or the name already.
    if (values[key] && values[key] !== pool.head) facts.push({ key, value: values[key] });
  }
  if (pool.capabilities?.length) facts.push({ key: "capabilities", value: pool.capabilities.join(" ") });
  return facts;
}

/** What the pool is on a node, as the node reports it: its head when its own, its use. */
export function poolNodeFacts(pool: SketchPool, view: SketchPool | undefined, format: (bytes: number) => string): SketchFact[] {
  if (!view) return [];
  const facts: SketchFact[] = [];
  if (view.head && view.head !== pool.head) facts.push({ key: "head", value: view.head });
  if (view.size) facts.push({ key: "used", value: `${format(view.used ?? 0)} / ${format(view.size)}` });
  return facts;
}

/**
 * The nodes a volume is drawn on: those holding it, and those its consumers run on, which
 * are all a daemon not telling the former gives. One no service uses is drawn on none.
 */
export const volumeNodes = (volume: SketchVolume) => {
  const children = volume.children ?? [];
  if (children.length === 0) return [];
  return [...new Set([...(volume.nodes ?? []), ...children.map((child) => child.split("@")[1]).filter(Boolean)])];
};

/** The input of the layout of the sketch of a pool: a volume an item on each node holding it, its size its detail. */
export function poolSketchInput(input: PoolSketchInput, format: (bytes: number) => string): SketchInput {
  const { pool, perNode, values, nodes, volumes } = input;
  return {
    title: `${pool.name} · ${pool.type}`,
    bandFacts: poolBandFacts({ pool, values }),
    nodes,
    nodeFacts: Object.fromEntries(nodes.map((node) => [node, poolNodeFacts(pool, perNode[node], format)])),
    items: volumes.flatMap((v) => {
      const on = volumeNodes(v);
      return on.length > 0 ? on.map((node) => ({ key: v.path, path: v.path, node })) : [{ key: v.path, path: v.path }];
    }),
    details: Object.fromEntries(volumes.filter((v) => v.size).map((v) => [v.path, format(v.size as number)])),
    route: null,
  };
}

/** The layout of the sketch of a pool. */
export function poolSketchLayout(input: PoolSketchInput, format: (bytes: number) => string): SketchLayout {
  return layoutSketch(poolSketchInput(input, format));
}
