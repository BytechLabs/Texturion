import { describe, expect, it } from "vitest";

import { normalizeNanpPhone } from "./phone";

describe("normalizeNanpPhone (E.164 normalization + US/CA NANP gate)", () => {
  it("normalizes human formats to +1 E.164", () => {
    expect(normalizeNanpPhone("(416) 555-0199")).toBe("+14165550199");
    expect(normalizeNanpPhone("416-555-0199")).toBe("+14165550199");
    expect(normalizeNanpPhone("1 416 555 0199")).toBe("+14165550199");
    expect(normalizeNanpPhone("+14165550199")).toBe("+14165550199");
    expect(normalizeNanpPhone(" 4165550199 ")).toBe("+14165550199");
  });

  it("rejects Caribbean NANP codes (SMS-pumping defense, SPEC §10)", () => {
    expect(normalizeNanpPhone("+12425550199")).toBeNull(); // Bahamas 242
    expect(normalizeNanpPhone("8765550199")).toBeNull(); // Jamaica 876
  });

  it("rejects toll-free and unassigned codes", () => {
    expect(normalizeNanpPhone("8005550199")).toBeNull();
    expect(normalizeNanpPhone("9995550199")).toBeNull();
  });

  it("rejects non-NANP input", () => {
    expect(normalizeNanpPhone("+447911123456")).toBeNull();
    expect(normalizeNanpPhone("12345")).toBeNull();
    expect(normalizeNanpPhone("")).toBeNull();
    expect(normalizeNanpPhone("not a phone")).toBeNull();
  });
});
