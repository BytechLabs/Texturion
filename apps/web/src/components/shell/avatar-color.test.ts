import { describe, expect, it } from "vitest";

import { avatarColorClass } from "./avatar-color";

// #582: the initials tests moved to packages/shared with the function itself —
// there were five implementations and now there is one, so there is one suite. The
// case that changed answer on the way is recorded there: "4th Street Deli" reads 4D
// under first-plus-last, not 4S, which is the stated cost of matching how a person
// reads a name with a middle name in it.
describe("avatarColorClass", () => {
  it("is deterministic per key", () => {
    expect(avatarColorClass("abc")).toBe(avatarColorClass("abc"));
  });
});
