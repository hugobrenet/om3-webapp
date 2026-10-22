import { describe, expect, test } from "vitest";
import {
  instanceId,
  parseInstanceId,
  parseResourceId,
  parseStep,
  resourceId,
  serialiseStep,
  stepIcon,
  stepLabel,
} from "../peek";

describe("peek steps", () => {
  test("a step is its kind, then its id, colons included", () => {
    expect(parseStep("object:ns1/svc/web")).toEqual({ kind: "object", id: "ns1/svc/web" });
    expect(parseStep("network:fe80::1")).toEqual({ kind: "network", id: "fe80::1" });
    expect(serialiseStep({ kind: "namespace", id: "ns1" })).toBe("namespace:ns1");
  });

  test.each([undefined, "", "object", ":x", "object:", "disk:x"])("%s is no step", (raw) => {
    expect(parseStep(raw)).toBeNull();
  });

  test("an instance by the path of its object and its node: path@node", () => {
    expect(instanceId("ns1/svc/web", "n1")).toBe("ns1/svc/web@n1");
    expect(parseStep("instance:ns1/svc/web@n1")).toEqual({ kind: "instance", id: "ns1/svc/web@n1" });
    expect(parseInstanceId("ns1/svc/web@n1")).toEqual({ path: "ns1/svc/web", node: "n1" });
    expect(parseInstanceId("svc@n1")).toEqual({ path: "svc", node: "n1" });
    expect(parseInstanceId("ns1/svc/web")).toBeNull();
    expect(parseInstanceId("@n1")).toBeNull();
    expect(parseInstanceId("ns1/svc/web@")).toBeNull();
    expect(stepIcon({ kind: "instance", id: "ns1/svc/web@n1" })).toBe("instance");
  });

  test("a resource by the path of its object and its rid: path:rid on all its nodes, path:rid@node on one instance", () => {
    expect(resourceId("ns1/svc/web", "fs#1")).toBe("ns1/svc/web:fs#1");
    expect(resourceId("ns1/svc/web", "fs#1", "n1")).toBe("ns1/svc/web:fs#1@n1");
    expect(parseResourceId("ns1/svc/web:fs#1")).toEqual({ path: "ns1/svc/web", rid: "fs#1" });
    expect(parseResourceId("ns1/svc/web:fs#1@n1")).toEqual({ path: "ns1/svc/web", rid: "fs#1", node: "n1" });
    expect(parseStep("resource:ns1/svc/web:fs#1@n1")).toEqual({ kind: "resource", id: "ns1/svc/web:fs#1@n1" });
    for (const id of ["ns1/svc/web", ":fs#1", "ns1/svc/web:", "ns1/svc/web:@n1", "ns1/svc/web:fs#1@"]) {
      expect(parseResourceId(id)).toBeNull();
    }
  });

  test("a record shows the icon of its kind, an object the one of its object kind", () => {
    expect(stepIcon({ kind: "object", id: "ns1/sec/key" })).toBe("secret");
    expect(stepIcon({ kind: "object", id: "ns1/svc/web" })).toBe("service");
    expect(stepIcon({ kind: "object", id: "vol/data" })).toBe("disk");
    expect(stepIcon({ kind: "network", id: "lo" })).toBe("network");
  });

  test("a record is named by its id", () => {
    expect(stepLabel({ kind: "object", id: "ns1/svc/web" })).toBe("ns1/svc/web");
  });
});
