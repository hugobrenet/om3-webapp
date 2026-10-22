import { describe, expect, test } from "vitest";
import { namespaceUsage, namespacesUsage, nodeUsage, objectUsage, readPg, sumUsage } from "../pg-usage";
import { namespaceOf } from "../namespace-usage";

const page = `# HELP opensvc_pg_cgroup_cpu_usage_usec cpu
opensvc_pg_cgroup_exists{namespace="prod",path="prod/svc/web"} 1
opensvc_pg_cgroup_cpu_usage_usec{namespace="prod",path="prod/svc/web"} 1000000
opensvc_pg_cgroup_memory_current_bytes{namespace="prod",path="prod/svc/web"} 2048
opensvc_pg_cgroup_memory_max_bytes{namespace="prod",path="prod/svc/web"} +Inf
opensvc_pg_cgroup_exists{namespace="prod",path="prod/svc/gone"} 0
opensvc_pg_cgroup_cpu_weight{namespace="prod",path="prod/svc/gone"} 100
opensvc_pg_cgroup_memory_current_bytes{namespace="root",path="svc/dns"} 1024
opensvc_pg_cgroups 3
`;

describe("readPg", () => {
  test("the objects with a cgroup on the node; one known without, the summaries, left out", () => {
    expect(readPg(page)).toEqual({
      "prod/svc/web": { namespace: "prod", cpuUsageUsec: 1000000, memoryCurrent: 2048, memoryMax: Infinity },
      "svc/dns": { namespace: "root", memoryCurrent: 1024 },
    });
  });
});

describe("nodeUsage", () => {
  const at = (ms: number, usec: number) => ({ at: ms, byPath: { "prod/svc/web": { namespace: "prod", cpuUsageUsec: usec, memoryCurrent: 1 } } });

  test("the cpu used between two readings, in cpus; none on the first one", () => {
    expect(nodeUsage(undefined, at(0, 0))["prod/svc/web"]).toEqual({ cpu: null, memory: 1, limit: undefined });
    // Two seconds of cpu over sixteen: an eighth of a cpu.
    expect(nodeUsage(at(0, 0), at(16000, 2000000))["prod/svc/web"].cpu).toBeCloseTo(0.125);
  });

  test("a counter gone back, a cgroup recreated: no rate this time", () => {
    expect(nodeUsage(at(0, 5000000), at(16000, 1000))["prod/svc/web"].cpu).toBeNull();
  });
});

describe("sums", () => {
  test("the cpus told, the memories, the limits; unlimited if one is", () => {
    expect(sumUsage([{ cpu: 0.5, memory: 10, limit: 100 }, { cpu: null, memory: 5, limit: Infinity }])).toEqual({
      cpu: 0.5,
      memory: 15,
      limit: Infinity,
    });
    expect(sumUsage([{ cpu: null }, { cpu: null }])).toEqual({ cpu: null, memory: undefined, limit: undefined });
  });

  const usage = {
    n2: { "prod/svc/web": { cpu: 0.25, memory: 20, limit: 100 } },
    n1: {
      "prod/svc/web": { cpu: 0.5, memory: 10, limit: 100 },
      "prod/svc/db": { cpu: 1, memory: 5 },
      "svc/dns": { cpu: 0.1, memory: 1 },
    },
  };

  test("an object: its instances in the order of the nodes, and their sum", () => {
    expect(objectUsage(usage, "prod/svc/web")).toEqual({
      path: "prod/svc/web",
      instances: [
        { node: "n1", cpu: 0.5, memory: 10, limit: 100 },
        { node: "n2", cpu: 0.25, memory: 20, limit: 100 },
      ],
      cpu: 0.75,
      memory: 30,
      limit: 200,
    });
    expect(objectUsage(usage, "prod/svc/none")).toEqual({ path: "prod/svc/none", instances: [], cpu: null, memory: undefined, limit: undefined });
  });

  test("a namespace: its objects summed over the nodes, and their sum; root's short paths its own", () => {
    const prod = namespaceUsage(usage, namespaceOf, "prod");
    expect(prod.objects.map((o) => o.path)).toEqual(["prod/svc/db", "prod/svc/web"]);
    expect(prod.cpu).toBeCloseTo(1.75);
    expect(prod.memory).toBe(35);
    const all = namespacesUsage(usage, namespaceOf);
    expect(Object.keys(all).sort()).toEqual(["prod", "root"]);
    expect(all.root).toEqual({ cpu: 0.1, memory: 1, limit: undefined });
  });
});
