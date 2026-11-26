import { describe, expect, test } from "vitest";
import { compareVersions, latestRelease, releaseOf } from "../release-check";

describe("compareVersions", () => {
  test("orders the release candidates by their number, not as text", () => {
    expect(compareVersions("v1.0.0-rc9", "v1.0.0-rc17")).toBe(-1);
    expect(compareVersions("1.0.0-rc17", "v1.0.0-rc16")).toBe(1);
    expect(compareVersions("v1.0.0-rc17", "1.0.0-rc17")).toBe(0);
  });
  test("a pre-release before its release, a release before the next", () => {
    expect(compareVersions("1.0.0-rc17", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.1-rc1")).toBe(-1);
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
  });
  test("one not a version before any that is", () => {
    expect(compareVersions("45177a638", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "")).toBe(1);
  });
});

describe("releaseOf", () => {
  test("the release a build is of, or past", () => {
    expect(releaseOf("v1.0.0-rc16-39-g451770638-dirty")).toBe("v1.0.0-rc16");
    expect(releaseOf("v1.0.0-rc16-39-g451770638")).toBe("v1.0.0-rc16");
    expect(releaseOf("v1.0.0-rc17")).toBe("v1.0.0-rc17");
    expect(releaseOf("v1.0.0-rc17-dirty")).toBe("v1.0.0-rc17");
  });
});

describe("latestRelease", () => {
  test("the highest version published, without its v, drafts left out", () => {
    expect(latestRelease([{ tag_name: "v1.0.0-rc16" }, { tag_name: "v1.0.0-rc17" }, { tag_name: "v2.0.0", draft: true }])).toBe("1.0.0-rc17");
  });
  test("none from an answer that is no list, or lists none", () => {
    expect(latestRelease({ message: "API rate limit exceeded" })).toBe("");
    expect(latestRelease([])).toBe("");
    expect(latestRelease([{}])).toBe("");
  });
});
