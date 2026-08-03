/**
 * #304 — the one question both the usage screen and the bookkeeper's export
 * ask about a period.
 *
 * UW-T2 is the reason this file exists as more than a formality. The SQL suite
 * proves `api_usage_window` honours its upper bound (UW-2 there), but nothing
 * proved the TypeScript half actually SENDS one: both callers today pass a
 * running period, so `p_to: null` is what goes over the wire either way. A
 * reader hard-coded to null would look identical to a correct one right up
 * until the first bookkeeper asked for a month that had ended — and would then
 * hand them every segment since, labelled as that month.
 *
 * Caught by breaking it: hard-coding `p_to: null` was invisible to all four
 * suites that exercise this module through its callers.
 */
import { describe, expect, it } from "vitest";

import { readUsageWindow } from "./usage-window";
import { endpoint, makeHarness } from "../test/billing-support";
import { completeEnv, stubFetch } from "../test/support";
import { getDb } from "../db";

const COMPANY_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

/** A window read against a stubbed PostgREST, returning what was sent. */
function harnessFor(row: Record<string, unknown> | null) {
  return makeHarness([
    endpoint("POST", /\/rpc\/api_usage_window/, () => (row === null ? [] : [row])),
  ]);
}

const FULL_ROW = {
  outbound_segments: 620,
  inbound_segments: 200,
  forward_seconds: 3660,
  reported_segments: 500,
  unreported_segments: 120,
};

describe("#304 readUsageWindow", () => {
  it("UW-T1: reads every arm of the window", async () => {
    const harness = harnessFor(FULL_ROW);
    stubFetch(harness.route);

    const totals = await readUsageWindow(getDb(completeEnv()), COMPANY_ID, {
      from: "2026-06-01T00:00:00.000Z",
      to: null,
    });

    expect(totals).toEqual({
      outboundSegments: 620,
      inboundSegments: 200,
      voiceSeconds: 3660,
      reportedSegments: 500,
      unreportedSegments: 120,
    });
  });

  it("UW-T2: a CLOSED window sends its upper bound", async () => {
    // The bookkeeper's whole request. A reader that dropped this — or pinned it
    // to null — would answer "June" with June onward, and the total would look
    // entirely plausible.
    const harness = harnessFor(FULL_ROW);
    stubFetch(harness.route);

    await readUsageWindow(getDb(completeEnv()), COMPANY_ID, {
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-06-30T23:59:59.999Z",
    });

    const sent = harness.callsTo("POST", /\/rpc\/api_usage_window/)[0];
    expect(sent.json()).toEqual({
      p_company_id: COMPANY_ID,
      p_from: "2026-06-01T00:00:00.000Z",
      p_to: "2026-06-30T23:59:59.999Z",
    });
  });

  it("UW-T3: a RUNNING period sends null, not a clock reading", async () => {
    // Deliberately not `now()`. A period that has not ended must not be trimmed
    // by whichever clock answered, and the sends in that gap would vanish from
    // a screen the owner is watching in real time.
    const harness = harnessFor(FULL_ROW);
    stubFetch(harness.route);

    await readUsageWindow(getDb(completeEnv()), COMPANY_ID, {
      from: "2026-06-01T00:00:00.000Z",
      to: null,
    });

    const sent = harness.callsTo("POST", /\/rpc\/api_usage_window/)[0];
    expect((sent.json() as { p_to: unknown }).p_to).toBeNull();
  });

  it("UW-T4: bigint sums arrive as strings and are still numbers", async () => {
    // PostgREST serialises bigint as a JSON string. Left uncoerced, the segment
    // total becomes "620" and every comparison downstream — the cap gate, the
    // overage arithmetic — silently switches to string semantics.
    const harness = harnessFor({
      outbound_segments: "620",
      inbound_segments: "200",
      forward_seconds: "3660",
      reported_segments: "500",
      unreported_segments: "120",
    });
    stubFetch(harness.route);

    const totals = await readUsageWindow(getDb(completeEnv()), COMPANY_ID, {
      from: "2026-06-01T00:00:00.000Z",
      to: null,
    });

    expect(totals.outboundSegments).toBe(620);
    expect(totals.voiceSeconds).toBe(3660);
  });

  it("UW-T5: no row reads as zeros, not as a crash", async () => {
    // The usage screen is a MEMBER surface — the composer reads it before a
    // send. A throw here would take out the send warning along with the meter.
    const harness = harnessFor(null);
    stubFetch(harness.route);

    const totals = await readUsageWindow(getDb(completeEnv()), COMPANY_ID, {
      from: "2026-06-01T00:00:00.000Z",
      to: null,
    });

    expect(totals.outboundSegments).toBe(0);
    expect(totals.unreportedSegments).toBe(0);
  });
});
