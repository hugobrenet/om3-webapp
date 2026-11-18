import { describe, expect, test } from "vitest";
import { arrayEndpoint, arraySections, poolsOfArray, sectionNames } from "../array-config";

const CONFIG = `[cluster]
name = dev3

[array#pure1]
type = pure
api = https://pure1.example.com/api
client_id = 1234
secret = ********

[array#emc1]
type = symmetrix
symcli_connect = emc1_conn
name = 000123

[pool#gold]
type = pure
array = pure1

[pool#split]
type = pure
array@n1 = pure1
array@n2 = pure2

[pool#local]
type = directory
path = /srv
`;

describe("array config", () => {
  test("the sections of a kind, by name, in their order", () => {
    expect(sectionNames(CONFIG, "array")).toEqual(["pure1", "emc1"]);
    expect(sectionNames(CONFIG, "pool")).toEqual(["gold", "split", "local"]);
  });

  test("where an array is reached: its api, else its url, its manager, its CLI connection", () => {
    const sections = arraySections(CONFIG);
    expect(arrayEndpoint(sections.pure1)).toBe("https://pure1.example.com/api");
    expect(arrayEndpoint(sections.emc1)).toBe("emc1_conn");
    expect(arrayEndpoint({ manager: "3par.example.com", url: "https://x" })).toBe("https://x");
    expect(arrayEndpoint({})).toBeUndefined();
  });

  test("the pools on an array: naming it on every node or on one", () => {
    expect(poolsOfArray(CONFIG, "pure1")).toEqual(["gold", "split"]);
    expect(poolsOfArray(CONFIG, "pure2")).toEqual(["split"]);
    expect(poolsOfArray(CONFIG, "emc1")).toEqual([]);
  });
});
