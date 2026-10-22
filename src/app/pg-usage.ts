/*
 * The cgroup usage of the objects, over every node of the cluster. Each daemon
 * serves the cgroups of its own node (`/metrics/pg`); the API relays any node's
 * (`/api/node/name/{node}/metrics/pg`). A reading of a node gives, for each object
 * with a cgroup there, its instance on that node: the cpu it used so far, the
 * memory it uses and its memory limit. Two readings give the cpu rate.
 *
 * Over the nodes, the figures of an object add up: its instances share nothing,
 * the cpu and the memory they use are the object's, their limits what the object
 * may use in all, unlimited if one of them is. Over the objects, a namespace's.
 */
import { parsePrometheusText } from "../utils/cgroupMetrics";

/** What a reading of a node says of an object with a cgroup there. */
export interface PgSample {
  namespace: string;
  /** Cpu time used so far, in microseconds. */
  cpuUsageUsec?: number;
  memoryCurrent?: number;
  /** Infinity: no limit. */
  memoryMax?: number;
}

/** A reading of a node: when, and its objects by path. */
export interface NodeReading {
  at: number;
  byPath: Record<string, PgSample>;
}

/** The usage of an instance: the cpu in cpus, null until a second reading tells it. */
export interface Usage {
  cpu: number | null;
  memory?: number;
  limit?: number;
}

/** The usage of the instances of each node, by object path. */
export type ClusterUsage = Record<string, Record<string, Usage>>;

const FIELDS: Record<string, keyof Omit<PgSample, "namespace">> = {
  opensvc_pg_cgroup_cpu_usage_usec: "cpuUsageUsec",
  opensvc_pg_cgroup_memory_current_bytes: "memoryCurrent",
  opensvc_pg_cgroup_memory_max_bytes: "memoryMax",
};

/**
 * The objects a reading tells of, with a cgroup on the node: those the daemon
 * knows without one there (`opensvc_pg_cgroup_exists 0`, no usage) left out.
 */
export function readPg(text: string): Record<string, PgSample> {
  const byPath: Record<string, PgSample> = {};
  const absent = new Set<string>();
  for (const { name, labels, value } of parsePrometheusText(text) as {
    name: string;
    labels: Record<string, string>;
    value: number;
  }[]) {
    const path = labels.path;
    if (!path) continue;
    if (name === "opensvc_pg_cgroup_exists" && value === 0) absent.add(path);
    const field = FIELDS[name];
    if (!field) continue;
    byPath[path] ??= { namespace: labels.namespace ?? "" };
    byPath[path][field] = value;
  }
  for (const path of absent) delete byPath[path];
  return byPath;
}

/**
 * The usage of the instances of a node, from its last reading and the one before:
 * the cpu used between them, in cpus; none on a first reading, nor for a counter
 * gone back, a cgroup recreated.
 */
export function nodeUsage(previous: NodeReading | undefined, current: NodeReading): Record<string, Usage> {
  const out: Record<string, Usage> = {};
  const elapsedUsec = previous ? (current.at - previous.at) * 1000 : 0;
  for (const [path, sample] of Object.entries(current.byPath)) {
    const before = previous?.byPath[path]?.cpuUsageUsec;
    const now = sample.cpuUsageUsec;
    const cpu =
      before === undefined || now === undefined || now < before || elapsedUsec <= 0 ? null : (now - before) / elapsedUsec;
    out[path] = { cpu, memory: sample.memoryCurrent, limit: sample.memoryMax };
  }
  return out;
}

/** The sum of usages: the cpus told, the memories, the limits, unlimited if one is. */
export function sumUsage(usages: Usage[]): Usage {
  const cpus = usages.map((u) => u.cpu).filter((c): c is number => c !== null && c !== undefined);
  const memories = usages.map((u) => u.memory).filter((m): m is number => m !== undefined);
  const limits = usages.map((u) => u.limit).filter((l): l is number => l !== undefined);
  return {
    cpu: cpus.length === 0 ? null : cpus.reduce((a, b) => a + b, 0),
    memory: memories.length === 0 ? undefined : memories.reduce((a, b) => a + b, 0),
    limit: limits.length === 0 ? undefined : limits.reduce((a, b) => a + b, 0),
  };
}

/** An instance of an object: its node, its usage there. */
export interface InstanceUsage extends Usage {
  node: string;
}

/** The usage of an object: its instances, node by node, and their sum. */
export interface ObjectUsage extends Usage {
  path: string;
  instances: InstanceUsage[];
}

/** The usage of an object over the nodes reporting it, its instances in the order of the nodes. */
export function objectUsage(usage: ClusterUsage, path: string): ObjectUsage {
  const instances = Object.keys(usage)
    .sort()
    .filter((node) => usage[node][path] !== undefined)
    .map((node) => ({ node, ...usage[node][path] }));
  return { path, instances, ...sumUsage(instances) };
}

/** The usage of the objects of a namespace over the nodes, and their sum. */
export function namespaceUsage(
  usage: ClusterUsage,
  namespaceOf: (path: string) => string,
  namespace: string,
): Usage & { objects: ObjectUsage[] } {
  const paths = new Set<string>();
  for (const byPath of Object.values(usage)) {
    for (const path of Object.keys(byPath)) if (namespaceOf(path) === namespace) paths.add(path);
  }
  const objects = [...paths].sort().map((path) => objectUsage(usage, path));
  return { objects, ...sumUsage(objects) };
}

/** The usage of every namespace, summed over its objects and the nodes. */
export function namespacesUsage(usage: ClusterUsage, namespaceOf: (path: string) => string): Record<string, Usage> {
  const byNamespace: Record<string, Usage[]> = {};
  for (const byPath of Object.values(usage)) {
    for (const [path, u] of Object.entries(byPath)) (byNamespace[namespaceOf(path)] ??= []).push(u);
  }
  return Object.fromEntries(Object.entries(byNamespace).map(([ns, list]) => [ns, sumUsage(list)]));
}
