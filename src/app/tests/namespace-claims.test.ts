import { describe, expect, test } from "vitest";
import {
  canWriteClaims,
  claimOps,
  formatLimit,
  limitError,
  limitValue,
  nextSection,
  opsQuery,
  toInput,
} from "../namespace-claims";

describe("limits", () => {
  test.each([
    ["pool", { amount: "20", unit: "g" }, "20g", 20 * 2 ** 30],
    ["memory", { amount: "1,5", unit: "t" }, "1.5t", 1.5 * 2 ** 40],
    ["network", { amount: "10", unit: "g" }, "10", 10],
    ["cpu", { amount: "8", unit: "g" }, "800%", 8],
    ["cpu", { amount: "0.5", unit: "g" }, "50%", 0.5],
  ] as const)("a %s of %o is written %s, read back as %d", (type, input, text, value) => {
    expect(limitError(type, input)).toBeNull();
    expect(formatLimit(type, input)).toBe(text);
    expect(limitValue(type, input)).toBe(value);
  });

  test.each([
    ["pool", "", "positive"],
    ["pool", "0", "positive"],
    ["memory", "-1", "positive"],
    ["pool", "5x", "positive"],
    ["network", "2.5", "integer"],
    ["cpu", "0.001", "cpuMin"],
  ] as const)("a %s of %p is not written: %s", (type, amount, error) => {
    expect(limitError(type, { amount, unit: "g" })).toBe(error);
    expect(limitValue(type, { amount, unit: "g" })).toBeUndefined();
  });

  test("an edit starts from the limit as written, else in MiB, else empty", () => {
    expect(toInput("memory", "16g")).toEqual({ amount: "16", unit: "g" });
    expect(toInput("pool", "512M")).toEqual({ amount: "512", unit: "m" });
    expect(toInput("pool", "1gb")).toEqual({ amount: String(Math.round((1e9 / 2 ** 20) * 100) / 100), unit: "m" });
    expect(toInput("pool", "huge")).toEqual({ amount: "", unit: "m" });
    expect(toInput("cpu", "400%")).toEqual({ amount: "4", unit: "g" });
    expect(toInput("cpu", "100%@8")).toEqual({ amount: "8", unit: "g" });
    expect(toInput("network", "10")).toEqual({ amount: "10", unit: "g" });
    expect(toInput("cpu", undefined).amount).toBe("");
  });
});

describe("writes", () => {
  test("a new claim goes after the highest section", () => {
    expect(nextSection([])).toBe("claim#1");
    expect(nextSection([{ type: "cpu", section: "claim#2" }, { type: "pool", section: "claim#7" }])).toBe("claim#8");
  });

  test("the operations of a claim: all its section, the default removed when emptied", () => {
    expect(claimOps({ section: "claim#3", type: "pool", name: "shm", limit: "2g" })).toEqual({
      set: ["claim#3.type=pool", "claim#3.name=shm", "claim#3.limit=2g"],
      unset: [],
    });
    expect(claimOps({ section: "claim#4", type: "cpu", limit: "200%", defaultLimit: "50%" })).toEqual({
      set: ["claim#4.type=cpu", "claim#4.limit=200%", "claim#4.default=50%"],
      unset: [],
    });
    expect(claimOps({ section: "claim#4", type: "memory", limit: "4g" }).unset).toEqual(["claim#4.default"]);
    expect(opsQuery({ set: ["claim#4.limit=200%"], delete: ["claim#1"] })).toBe("set=claim%234.limit%3D200%25&delete=claim%231");
  });

  test("root and the squatters write the claims; an admin of the namespace does not", () => {
    expect(canWriteClaims({ root: null })).toBe(true);
    expect(canWriteClaims({ squatter: null })).toBe(true);
    expect(canWriteClaims({ admin: ["prod"] })).toBe(false);
    expect(canWriteClaims({})).toBe(false);
  });
});
