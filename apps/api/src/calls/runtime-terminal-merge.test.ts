import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { rpcMatch, stubRoute } from "../test/messaging-support";
import { completeEnv, stubFetch } from "../test/support";
import { createSessionRuntime } from "./runtime";
import { reduce } from "./transitions";

const ENV = completeEnv();
const NOW = Date.UTC(2026, 10, 17, 12);
const STARTED_AT = NOW - 45_000;
const SESSION_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const NUMBER_ID = "22222222-2222-4222-8222-222222222222";

function callMachine(direction: "inbound" | "outbound") {
  const result = reduce(null, {
    type: "initiated",
    context: {
      callSessionId: SESSION_ID,
      inboundCcid: "customer-leg",
      companyId: COMPANY_ID,
      phoneNumberId: NUMBER_ID,
      companyName: "Reed Roofing",
      greeting: null,
      callerE164: "+12125550123",
      businessNumberE164: "+14165550123",
      afterHours: false,
      nextOpenLabel: null,
      ringStrategy: "all",
      ringSeconds: 45,
      afterHoursVoicemail: false,
      lineBusy: false,
      screeningDivert: false,
      suspendedOrInactive: false,
      noticeAllowed: false,
      overCap: false,
      blocked: false,
      dialTargets: [],
      pushAudience: [],
    },
  }, STARTED_AT, () => "effect-key");
  if (!result.machine) throw new Error("The call did not start");
  return { ...result.machine, direction };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("terminalMergeSynthetic", () => {
  it.each([
    { answer: new Date(NOW - 12_750).toISOString(), seconds: 13 },
    { answer: new Date(NOW + 5000).toISOString(), seconds: 0 },
    { answer: "invalid answer time", seconds: 0 },
    { answer: null, seconds: 0 },
  ])("merges and threads an answered call with answer time $answer", async ({ answer, seconds }) => {
    const merge = stubRoute(rpcMatch(ENV, "api_upsert_call"), () => null);
    const thread = stubRoute(rpcMatch(ENV, "api_thread_call"), () => null);
    stubFetch(merge.route, thread.route);
    vi.setSystemTime(NOW + 30_000);

    await createSessionRuntime(ENV).terminalMergeSynthetic(callMachine("inbound"), "answered", answer, NOW);

    expect(merge.calls.map(({ body }) => body)).toEqual([{
      p_company_id: COMPANY_ID,
      p_phone_number_id: NUMBER_ID,
      p_call_session_id: SESSION_ID,
      p_caller_e164: "+12125550123",
      p_outcome: "answered",
      p_forward_seconds: seconds,
      p_started_at: new Date(STARTED_AT).toISOString(),
      p_ended_at: new Date(NOW).toISOString(),
      p_direction: "inbound",
    }]);
    expect(thread.calls[0]?.body).toMatchObject({
      p_call_session_id: SESSION_ID,
      p_forward_seconds: seconds,
      p_direction: "inbound",
      p_create_if_missing: true,
    });
  });

  it("threads a missed outbound call without sending an inbound text-back or alert", async () => {
    const merge = stubRoute(rpcMatch(ENV, "api_upsert_call"), () => null);
    const thread = stubRoute(rpcMatch(ENV, "api_thread_call"), () => null);
    stubFetch(merge.route, thread.route);

    await createSessionRuntime(ENV).terminalMergeSynthetic(callMachine("outbound"), "missed", null, NOW);

    expect(merge.calls[0]?.body).toMatchObject({ p_outcome: "missed", p_direction: "outbound" });
    expect(thread.calls[0]?.body).toMatchObject({ p_direction: "outbound", p_create_if_missing: false });
  });

  it("surfaces a failed call write before threading", async () => {
    const merge = stubRoute(rpcMatch(ENV, "api_upsert_call"), () =>
      Response.json({ message: "database unavailable" }, { status: 500 }),
    );
    const thread = stubRoute(rpcMatch(ENV, "api_thread_call"), () => null);
    stubFetch(merge.route, thread.route);

    await expect(createSessionRuntime(ENV).terminalMergeSynthetic(callMachine("inbound"), "missed", null, NOW))
      .rejects.toThrow("calls-v3 synthetic merge failed: database unavailable");
    expect(thread.calls).toEqual([]);
  });
});
