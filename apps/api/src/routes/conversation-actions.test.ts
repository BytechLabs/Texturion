import { describe, expect, it } from "vitest";

import { ApiError } from "../http/errors";
import {
  assertConversationPatchAllowed,
  conversationAllowedActions,
  statusMoveAction,
} from "./conversation-actions";

describe("conversation actions (#722)", () => {
  it("maps a requested status to the machine's action", () => {
    expect(statusMoveAction("closed", "open")).toBe("reopen");
    expect(statusMoveAction("waiting", "open")).toBe("mark_open");
    expect(statusMoveAction("open", "waiting")).toBe("mark_waiting");
    expect(statusMoveAction("open", "closed")).toBe("close");
    expect(statusMoveAction("open", "new")).toBe("mark_new");
  });

  it("carries the status moves and the spam action in one list", () => {
    expect(conversationAllowedActions({ status: "new", is_spam: false }, "member")).toEqual(
      expect.arrayContaining(["mark_open", "mark_waiting", "close", "mark_spam"]),
    );
    expect(conversationAllowedActions({ status: "closed", is_spam: true }, "member")).toEqual(
      expect.arrayContaining(["reopen", "mark_waiting", "mark_new", "unmark_spam"]),
    );
    expect(conversationAllowedActions({ status: "open", is_spam: false }, "read_only")).toEqual([]);
  });

  it("allows every status move the route accepted before, for a member", () => {
    const states = ["new", "open", "waiting", "closed"] as const;
    for (const from of states) {
      for (const to of states) {
        expect(() =>
          assertConversationPatchAllowed({ status: from, is_spam: false }, "member", { status: to }),
        ).not.toThrow();
      }
    }
  });

  it("refuses a move or spam flip outside the allowed list, and ignores a no-op", () => {
    const row = { status: "open", is_spam: false };
    expect(() => assertConversationPatchAllowed(row, "read_only", { status: "closed" })).toThrow(ApiError);
    expect(() => assertConversationPatchAllowed(row, "read_only", { is_spam: true })).toThrow(ApiError);
    expect(() => assertConversationPatchAllowed(row, "read_only", { status: "open", is_spam: false })).not.toThrow();
    expect(() => assertConversationPatchAllowed(row, "member", { is_spam: true })).not.toThrow();
  });
});
