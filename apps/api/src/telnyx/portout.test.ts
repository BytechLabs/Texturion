/**
 * #398 — a number leaving us used to be completely invisible.
 *
 * The row stayed active, texts stopped arriving, and we kept billing. The
 * assertions that matter here are about WHEN we speak: the pending notice is
 * the only window in which an unauthorised port can still be stopped, so it has
 * to reach both the customer and ops before anything has completed.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { parsePortOutEvent } from "./portout";
import type { TelnyxEvent } from "../messaging/types";

function event(payload: Record<string, unknown>): TelnyxEvent {
  return { data: { event_type: "portout.status_changed", payload } } as TelnyxEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reading a port-out notice", () => {
  it("takes the id, status and numbers off the payload", () => {
    const notice = parsePortOutEvent(
      event({
        portout_id: "po-1",
        status: "pending",
        phone_numbers: ["+16135551001"],
        carrier_name: "Some Other Carrier",
        foc_date: "2026-08-04T00:00:00Z",
      }),
    );
    expect(notice).toEqual({
      portoutId: "po-1",
      status: "pending",
      phoneNumbers: ["+16135551001"],
      carrierName: "Some Other Carrier",
      focDate: "2026-08-04T00:00:00Z",
    });
  });

  it("accepts `id` when Telnyx sends that instead of `portout_id`", () => {
    const notice = parsePortOutEvent(
      event({ id: "po-2", status: "ported", phone_numbers: ["+16135551002"] }),
    );
    expect(notice?.portoutId).toBe("po-2");
    expect(notice?.carrierName).toBeNull();
    expect(notice?.focDate).toBeNull();
  });

  it("carries every number on a multi-number port", () => {
    // A business porting away takes all of its numbers at once, and each one
    // is a separate row of ours to mark and a separate thing to alert on.
    const notice = parsePortOutEvent(
      event({
        portout_id: "po-3",
        status: "authorized",
        phone_numbers: ["+16135551003", "+16135551004"],
      }),
    );
    expect(notice?.phoneNumbers).toEqual(["+16135551003", "+16135551004"]);
  });

  it.each([
    ["no id", { status: "pending", phone_numbers: ["+1613555100"] }],
    ["no status", { portout_id: "po-4", phone_numbers: ["+1613555100"] }],
    ["no numbers", { portout_id: "po-4", status: "pending" }],
    ["numbers not an array", {
      portout_id: "po-4",
      status: "pending",
      phone_numbers: "+16135551001",
    }],
    ["empty payload", {}],
  ])("returns null rather than throwing on %s", (_label, payload) => {
    // The dispatcher acks Telnyx. A payload we cannot read must not wedge the
    // retry queue behind it.
    expect(parsePortOutEvent(event(payload))).toBeNull();
  });

  it("drops non-string entries instead of trusting the array", () => {
    const notice = parsePortOutEvent(
      event({
        portout_id: "po-5",
        status: "pending",
        phone_numbers: ["+16135551005", null, 42, ""],
      }),
    );
    expect(notice?.phoneNumbers).toEqual(["+16135551005"]);
  });
});
