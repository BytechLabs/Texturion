import { describe, expect, it } from "vitest";

import {
  formatNanpAsYouType,
  looksLikePhoneInput,
  normalizeNanpInput,
} from "./e164";

describe("formatNanpAsYouType", () => {
  it("formats progressively as digits arrive", () => {
    expect(formatNanpAsYouType("")).toBe("");
    expect(formatNanpAsYouType("4")).toBe("(4");
    expect(formatNanpAsYouType("416")).toBe("(416");
    expect(formatNanpAsYouType("4165")).toBe("(416) 5");
    expect(formatNanpAsYouType("416555")).toBe("(416) 555");
    expect(formatNanpAsYouType("4165550")).toBe("(416) 555-0");
    expect(formatNanpAsYouType("4165550182")).toBe("(416) 555-0182");
  });

  it("accepts pasted formats: +1, leading 1, punctuation", () => {
    expect(formatNanpAsYouType("+1 416-555-0182")).toBe("(416) 555-0182");
    expect(formatNanpAsYouType("14165550182")).toBe("(416) 555-0182");
    expect(formatNanpAsYouType("(416) 555.0182")).toBe("(416) 555-0182");
  });

  it("ignores overflow digits past 10", () => {
    expect(formatNanpAsYouType("41655501829999")).toBe("(416) 555-0182");
  });
});

describe("normalizeNanpInput", () => {
  it("returns strict E.164 for valid US/CA numbers", () => {
    expect(normalizeNanpInput("(416) 555-0182")).toBe("+14165550182");
    expect(normalizeNanpInput("+1 212 555 0100")).toBe("+12125550100");
    expect(normalizeNanpInput("12125550100")).toBe("+12125550100");
  });

  it("rejects incomplete, non-NANP, and Caribbean +1 numbers", () => {
    expect(normalizeNanpInput("")).toBeNull();
    expect(normalizeNanpInput("416555")).toBeNull();
    expect(normalizeNanpInput("+44 20 7946 0958")).toBeNull();
    // 876 = Jamaica: +1 but not a US/CA destination (SPEC §10 layer 2).
    expect(normalizeNanpInput("8765550100")).toBeNull();
    // 800 toll-free is not a texting destination either.
    expect(normalizeNanpInput("8005550100")).toBeNull();
  });
});

describe("looksLikePhoneInput", () => {
  it("distinguishes numbers from name searches", () => {
    expect(looksLikePhoneInput("416")).toBe(true);
    expect(looksLikePhoneInput("(416) 5")).toBe(true);
    expect(looksLikePhoneInput("Maria")).toBe(false);
    expect(looksLikePhoneInput("maria 2")).toBe(false);
  });
});
