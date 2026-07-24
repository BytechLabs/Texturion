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
  recordVoiceCost,
} from "./provider-costs";

/**
 * A minimal fluent Supabase double for recordVoiceCost: the `calls` lookup
 * (`.select().in().limit()`) and the `provider_costs` upsert. Each can be told
 * to return a transient error so we can assert the transient-vs-skip signal.
 */
function fakeDb(opts: {
  callsError?: boolean;
  callsData?: { company_id: string }[];
  upsertError?: boolean;
}) {
  return {
    from(table: string) {
      if (table === "calls") {
        return {
          select: () => ({
            in: () => ({
              limit: async () =>
                opts.callsError
                  ? { data: null, error: { message: "boom" } }
                  : { data: opts.callsData ?? [{ company_id: "c1" }], error: null },
            }),
          }),
        };
      }
      return {
        upsert: async () =>
          opts.upsertError ? { error: { message: "boom" } } : { error: null },
      };
    },
  } as unknown as Parameters<typeof recordVoiceCost>[0];
}

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

describe("recordVoiceCost transient-vs-skip signal (#216 sweeper recovery)", () => {
  const payload = {
    call_leg_id: "leg-1",
    client_state: REAL_CLIENT_STATE,
    total_cost: "0.02",
  };

  it("returns FALSE on a transient calls-lookup error (caller must not stamp processed)", async () => {
    expect(await recordVoiceCost(fakeDb({ callsError: true }), payload)).toBe(
      false,
    );
  });

  it("returns FALSE when the provider_costs upsert hits a transient error", async () => {
    expect(
      await recordVoiceCost(
        fakeDb({ callsData: [{ company_id: "c1" }], upsertError: true }),
        payload,
      ),
    ).toBe(false);
  });

  it("returns TRUE on a definite skip (untracked leg — no company row)", async () => {
    expect(await recordVoiceCost(fakeDb({ callsData: [] }), payload)).toBe(true);
  });

  it("returns TRUE on a payload with no candidates (definite skip)", async () => {
    expect(await recordVoiceCost(fakeDb({}), { total_cost: "0.02" })).toBe(true);
  });

  it("returns TRUE after a successful record", async () => {
    expect(
      await recordVoiceCost(fakeDb({ callsData: [{ company_id: "c1" }] }), payload),
    ).toBe(true);
  });
});
