import { describe, expect, it } from "vitest";

import { firstMessagePreview, identificationFooter } from "./footer-preview";

describe("identificationFooter", () => {
  it("matches the API's exact footer string (SPEC §5)", () => {
    expect(identificationFooter("Mike's Plumbing")).toBe(
      "— Mike's Plumbing. Reply STOP to opt out",
    );
  });

  it("never mangles punctuation in the business name", () => {
    expect(identificationFooter("A & B — Cleaning, Inc.")).toBe(
      "— A & B — Cleaning, Inc.. Reply STOP to opt out",
    );
  });
});

describe("firstMessagePreview", () => {
  it("appends the footer on its own line after the body", () => {
    expect(firstMessagePreview("On our way!", "Acme Plumbing")).toBe(
      "On our way!\n— Acme Plumbing. Reply STOP to opt out",
    );
  });

  it("shows the footer alone for an empty body (no stray newline)", () => {
    expect(firstMessagePreview("", "Acme Plumbing")).toBe(
      "— Acme Plumbing. Reply STOP to opt out",
    );
  });

  it("mirrors the API composition byte-for-byte for a multi-line body", () => {
    const body = "Hi Sam,\nwe can come Tuesday at 3pm.";
    expect(firstMessagePreview(body, "Acme")).toBe(
      `${body}\n— Acme. Reply STOP to opt out`,
    );
  });
});
