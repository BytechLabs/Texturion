import { describe, expect, it } from "vitest";

import { authLocale } from "./auth-locale";

describe(authLocale, () => {
  it("honours an explicit signup locale before the device language", () => {
    expect(authLocale("fr-CA", "en-US")).toBe("fr-CA");
    expect(authLocale("en", "fr-CA")).toBe("en");
  });

  it("negotiates one of the supported languages from the browser header", () => {
    expect(authLocale(null, "de-DE,fr-FR;q=0.8,en-US;q=0.5")).toBe("fr-CA");
    expect(authLocale("unknown", "fr;q=0,en-CA;q=0.6")).toBe("en");
    expect(authLocale(null, null)).toBe("en");
  });
});
