import { describe, expect, it } from "vitest";

import { messageStatusPatch, type MessageStatusEvent } from "./events";

describe("messageStatusPatch", () => {
  it("always carries the delivery status (null for notes)", () => {
    expect(messageStatusPatch({ message_id: "m1", status: "delivered" })).toEqual(
      { status: "delivered" },
    );
    expect(messageStatusPatch({ message_id: "m1", status: null })).toEqual({
      status: null,
    });
  });

  it("applies the D14 done fields when the payload carries them", () => {
    const event: MessageStatusEvent = {
      message_id: "m1",
      status: "received",
      done_at: "2026-07-04T10:00:00Z",
      done_by_user_id: "u1",
    };
    expect(messageStatusPatch(event)).toEqual({
      status: "received",
      done_at: "2026-07-04T10:00:00Z",
      done_by_user_id: "u1",
    });
  });

  it("applies the #3 pin fields when the payload carries them", () => {
    const event: MessageStatusEvent = {
      message_id: "m1",
      status: "received",
      pinned_at: "2026-07-04T11:00:00Z",
      pinned_by_user_id: "u2",
    };
    expect(messageStatusPatch(event)).toEqual({
      status: "received",
      pinned_at: "2026-07-04T11:00:00Z",
      pinned_by_user_id: "u2",
    });
  });

  it("carries an explicit clear (null) for done/pin when present in the payload", () => {
    const event: MessageStatusEvent = {
      message_id: "m1",
      status: "received",
      done_at: null,
      done_by_user_id: null,
      pinned_at: null,
      pinned_by_user_id: null,
    };
    expect(messageStatusPatch(event)).toEqual({
      status: "received",
      done_at: null,
      done_by_user_id: null,
      pinned_at: null,
      pinned_by_user_id: null,
    });
  });

  it("omits done/pin keys entirely when absent, so an old payload never wipes local state", () => {
    // A pre-migration payload with only the delivery status must NOT introduce
    // done_at/pinned_at keys (which would overwrite live done/pin state with
    // undefined→null on merge).
    const patch = messageStatusPatch({ message_id: "m1", status: "sent" });
    expect(patch).toEqual({ status: "sent" });
    expect("done_at" in patch).toBe(false);
    expect("pinned_at" in patch).toBe(false);
  });
});
