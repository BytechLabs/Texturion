/**
 * #216 — pure parsing for the Telnyx actual-cost capture: dollar-amount
 * parsing, session-id extraction from a client_state, and the call.cost payload
 * shape. Exercised with the real prod payload the founder captured.
 */
import { describe, expect, it } from "vitest";

import {
  decodeSessionCandidates,
  parseCallCost,
  parseCostUsd,
} from "./provider-costs";

// The real call.cost client_state from prod: base64 of
// "op|724e6c88-c967-46c4-a33d-1ae057336584|4121d6eb-a2fc-42e5-a5f3-8e414a3824f1"
const REAL_CLIENT_STATE =
  "b3B8NzI0ZTZjODgtYzk2Ny00NmM0LWEzM2QtMWFlMDU3MzM2NTg0fDQxMjFkNmViLWEyZmMtNDJlNS1hNWYzLThlNDE0YTM4MjRmMQ==";
const SESSION_ID = "724e6c88-c967-46c4-a33d-1ae057336584";
const USER_ID = "4121d6eb-a2fc-42e5-a5f3-8e414a3824f1";

describe("parseCostUsd", () => {
  it("parses a decimal-string amount", () => {
    expect(parseCostUsd("0.0227")).toBeCloseTo(0.0227, 6);
    expect(parseCostUsd("1.5")).toBe(1.5);
  });
  it("treats zero / missing / negative / garbage as 0", () => {
    expect(parseCostUsd("0.0000")).toBe(0);
    expect(parseCostUsd(null)).toBe(0);
    expect(parseCostUsd(undefined)).toBe(0);
    expect(parseCostUsd("-0.01")).toBe(0);
    expect(parseCostUsd("abc")).toBe(0);
  });
});

describe("decodeSessionCandidates", () => {
  it("extracts every UUID-shaped part from a real op client_state", () => {
    const c = decodeSessionCandidates(REAL_CLIENT_STATE);
    // 'op' is dropped; both UUIDs (session id AND user id) are candidates — the
    // calls lookup disambiguates to the one that is a real session.
    expect(c).toContain(SESSION_ID);
    expect(c).toContain(USER_ID);
    expect(c).not.toContain("op");
  });
  it("returns [] for empty / non-base64 / no-UUID input", () => {
    expect(decodeSessionCandidates("")).toEqual([]);
    expect(decodeSessionCandidates(null)).toEqual([]);
    expect(decodeSessionCandidates(undefined)).toEqual([]);
    // base64 of "hello|world" — decodes fine but has no UUIDs.
    expect(decodeSessionCandidates("aGVsbG98d29ybGQ=")).toEqual([]);
  });
});

describe("parseCallCost", () => {
  it("parses the real call.cost payload", () => {
    const parsed = parseCallCost({
      billed_duration_secs: 0,
      call_control_id: "v3:ShGl7VA5dqjxxAbhJ8AXAqKfelJskfbLCyM9",
      call_leg_id: "3215196a-871f-11f1-b329-02420aef8e1f",
      call_session_id: "3211758a-871f-11f1-ba22-02420aef8e1f",
      client_state: REAL_CLIENT_STATE,
      total_cost: "0.0000",
      status: "success",
    });
    expect(parsed?.callLegId).toBe("3215196a-871f-11f1-b329-02420aef8e1f");
    expect(parsed?.candidates).toContain(SESSION_ID);
    expect(parsed?.costUsd).toBe(0);
  });

  it("carries a non-zero total_cost through", () => {
    const parsed = parseCallCost({
      call_leg_id: "leg-1",
      client_state: REAL_CLIENT_STATE,
      total_cost: "0.0180",
    });
    expect(parsed?.costUsd).toBeCloseTo(0.018, 6);
  });

  it("returns null without a call_leg_id (nothing to key on)", () => {
    expect(parseCallCost({ total_cost: "0.05" })).toBeNull();
    expect(parseCallCost(null)).toBeNull();
  });
});
