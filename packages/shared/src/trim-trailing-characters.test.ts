import { describe, expect, it } from "vitest";

import { trimTrailingCharacters } from "./trim-trailing-characters";

describe(trimTrailingCharacters, () => {
  it("strips only the named trailing characters", () => {
    expect(trimTrailingCharacters("https://example.com///", "/")).toBe("https://example.com");
    expect(trimTrailingCharacters("https://example.com/v1/", "/")).toBe("https://example.com/v1");
    expect(trimTrailingCharacters("https://example.com", "/")).toBe("https://example.com");
    expect(trimTrailingCharacters("///", "/")).toBe("");
    expect(trimTrailingCharacters("", "/")).toBe("");
  });

  it("handles long runs of trailing characters in linear time", () => {
    const base = "https://example.com/a/".repeat(250);
    const input = `${base}${"/".repeat(50_000)}`;
    expect(trimTrailingCharacters(input, "/")).toBe(base.slice(0, -1));
  });
});
