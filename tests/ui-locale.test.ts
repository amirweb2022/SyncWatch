import { describe, expect, it } from "vitest";
import { getUiLocale, getUiLocaleHref, readPreferredUiLocale } from "../lib/ui-locale";

describe("UI locale selection", () => {
  it("uses Persian by default and accepts an explicit English override", () => {
    expect(getUiLocale("")).toBe("fa");
    expect(getUiLocale("?lang=en")).toBe("en");
    expect(getUiLocale("?lang=unknown")).toBe("fa");
  });

  it("keeps unrelated query parameters when changing locale", () => {
    expect(getUiLocaleHref("?invite=ABC123", "en")).toBe("?invite=ABC123&lang=en");
    expect(getUiLocaleHref("?lang=en&invite=ABC123", "fa")).toBe("?invite=ABC123");
  });

  it("only accepts saved locale values", () => {
    expect(readPreferredUiLocale({ getItem: () => "en" })).toBe("en");
    expect(readPreferredUiLocale({ getItem: () => "fa" })).toBe("fa");
    expect(readPreferredUiLocale({ getItem: () => "fr" })).toBeNull();
  });
});
