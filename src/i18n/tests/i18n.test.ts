import { afterEach, describe, expect, test, vi } from "vitest";
import i18n, { browserLanguage, cachedLanguage, setLanguage } from "../index";

describe("browserLanguage", () => {
  test.each([
    ["fr-FR", "fr"],
    ["fr", "fr"],
    ["FR-ca", "fr"],
    ["en-US", "en"],
    ["de-DE", "en"],
    [undefined, "en"],
  ])("%s speaks %s", (language, expected) => {
    expect(browserLanguage(language)).toBe(expected);
  });
});

describe("the language chosen", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    localStorage.removeItem("om3.language");
    await i18n.changeLanguage("en");
  });

  test("kept, it is the one of the next loads; none kept, the browser's", () => {
    expect(cachedLanguage()).toBe("en");
    localStorage.setItem("om3.language", "fr");
    expect(cachedLanguage()).toBe("fr");
    // A value not of the webapp is left for the browser's.
    localStorage.setItem("om3.language", "de");
    expect(cachedLanguage()).toBe("en");
  });

  test("set, it speaks at once and is kept", async () => {
    await setLanguage("fr");
    expect(i18n.language).toBe("fr");
    expect(i18n.t("user.language")).toBe("Langue");
    expect(localStorage.getItem("om3.language")).toBe("fr");
    expect(document.documentElement.lang).toBe("fr");
  });

  test("without storage, it still speaks, and the browser's is read", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    await setLanguage("fr");
    expect(i18n.language).toBe("fr");
    expect(cachedLanguage()).toBe("en");
  });
});
