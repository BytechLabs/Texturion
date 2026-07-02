import { describe, expect, it } from "vitest";

import { activeConversationFromPath } from "./path";

describe("activeConversationFromPath (G9 toast suppression)", () => {
  it("extracts the conversation id from a thread URL", () => {
    expect(activeConversationFromPath("/inbox/abc-123")).toBe("abc-123");
  });

  it("treats the inbox list, compose flow, and other pages as not-viewing", () => {
    expect(activeConversationFromPath("/inbox")).toBeNull();
    expect(activeConversationFromPath("/inbox/new")).toBeNull();
    expect(activeConversationFromPath("/contacts/abc")).toBeNull();
    expect(activeConversationFromPath("/")).toBeNull();
  });
});
