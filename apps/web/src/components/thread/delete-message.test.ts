import { describe, expect, it } from "vitest";

import { deletedMessageKey } from "./delete-message";

describe("deletedMessageKey", () => {
  it("warns that a sent text stays on the customer's phone", () => {
    expect(deletedMessageKey({ direction: "outbound", status: "delivered" })).toBe(
      "trash.messageDeletedSent",
    );
    expect(deletedMessageKey({ direction: "outbound", status: "sent" })).toBe(
      "trash.messageDeletedSent",
    );
  });

  it("does not claim a carrier copy for a note or a send that failed", () => {
    expect(deletedMessageKey({ direction: "note", status: null })).toBe(
      "trash.noteDeleted",
    );
    expect(deletedMessageKey({ direction: "outbound", status: "failed" })).toBe(
      "trash.messageDeleted",
    );
    expect(deletedMessageKey({ direction: "inbound", status: "delivered" })).toBe(
      "trash.messageDeleted",
    );
  });
});
