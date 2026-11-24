import {describe, expect, test} from "vitest";
import {basicAuthorization} from "../basicAuth.js";

describe("basicAuthorization", () => {
    test("ASCII as btoa had it", () => {
        expect(basicAuthorization("root", "s3cr3t")).toBe(`Basic ${btoa("root:s3cr3t")}`);
    });

    test("in UTF-8: an é its two bytes, not its Latin-1 one", () => {
        expect(basicAuthorization("a", "é")).toBe("Basic YTrDqQ==");
    });

    test("past Latin-1, a € its three bytes, no error", () => {
        expect(basicAuthorization("a", "€")).toBe("Basic YTrigqw=");
    });

    test("a colon in the password kept: only the first one splits", () => {
        expect(basicAuthorization("a", "b:c")).toBe(`Basic ${btoa("a:b:c")}`);
    });
});
