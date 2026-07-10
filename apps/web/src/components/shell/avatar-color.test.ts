import { describe, expect, it } from "vitest";

import { avatarColorClass, avatarInitials } from "./avatar-color";

describe("avatarInitials", () => {
  it("takes the first letters of the first two words", () => {
    expect(avatarInitials("Maria Alvarez")).toBe("MA");
    expect(avatarInitials("dana brightside")).toBe("DB");
  });

  it("takes two letters from a single-word name", () => {
    expect(avatarInitials("Maria")).toBe("MA");
  });

  it("keeps leading digits in real names", () => {
    expect(avatarInitials("4th Street Deli")).toBe("4S");
  });

  it("renders # for a bare phone-number display name, never punctuation", () => {
    // Unnamed contacts display as their formatted number; "(415) 555-0133"
    // used to produce "(5".
    expect(avatarInitials("(415) 555-0133")).toBe("#");
    expect(avatarInitials("+14155550133")).toBe("#");
  });

  it("skips punctuation-only words", () => {
    expect(avatarInitials("· Maria")).toBe("MA");
  });

  it("falls back to ? for empty input", () => {
    expect(avatarInitials("")).toBe("?");
    expect(avatarInitials("   ")).toBe("?");
  });
});

describe("avatarColorClass", () => {
  it("is deterministic per key", () => {
    expect(avatarColorClass("abc")).toBe(avatarColorClass("abc"));
  });
});
