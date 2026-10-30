/**
 * D142: the call engine's missed-call alert records its push evidence in the
 * background. The call-end push is queued behind the terminal merge, so an
 * awaited evidence write would delay it. A Worker request keeps the awaited
 * write; push-attempts-senders.test.ts holds that half.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendMissedCallText } from "../messaging/missed-call";
import { handleTerminalCallEvent } from "../messaging/voice-webhook";
import { notifyMissedCall } from "../notifications/missed-call";
import { completeEnv, stubFetch } from "../test/support";
import { createSessionRuntime } from "./runtime";

vi.mock("../messaging/voice-webhook", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../messaging/voice-webhook")>()),
  handleTerminalCallEvent: vi.fn(async () => undefined),
  threadCallSession: vi.fn(async () => ({ eventInserted: true, conversationId: "conv-1" })),
}));
vi.mock("../messaging/missed-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../messaging/missed-call")>()),
  sendMissedCallText: vi.fn(async () => ({ alerted: false })),
}));
vi.mock("../notifications/missed-call", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../notifications/missed-call")>()),
  notifyMissedCall: vi.fn(async () => undefined),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const MISSED_INBOUND = {
  companyId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  phoneNumberId: "11111111-1111-4111-8111-111111111111",
  callSessionId: "4f6a1c2e-8b3d-4e5f-9a0b-1c2d3e4f5a6b",
  callerE164: "+16135550142",
  businessNumberE164: "+16135550100",
  startedAtMs: Date.now() - 30_000,
  direction: "inbound",
};

describe("the call engine's terminal merge", () => {
  it("asks the event path to record its alert's evidence in the background", async () => {
    const runtime = createSessionRuntime(completeEnv());
    await runtime.terminalMergeEvent({ call_session_id: MISSED_INBOUND.callSessionId } as never, {
      outboundSessionId: undefined,
    } as never);

    expect(vi.mocked(handleTerminalCallEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(handleTerminalCallEvent).mock.calls[0]![4]).toMatchObject({
      recordAttemptsInBackground: true,
    });
  });

  it("records the synthetic path's text-back alert and its plain alert in the background", async () => {
    stubFetch((url) =>
      url.pathname === "/rest/v1/rpc/api_upsert_call" ? Response.json(null) : undefined,
    );
    const runtime = createSessionRuntime(completeEnv());
    await runtime.terminalMergeSynthetic(MISSED_INBOUND as never, "missed", null);

    expect(vi.mocked(sendMissedCallText).mock.calls[0]![2]).toMatchObject({
      recordAttemptsInBackground: true,
    });
    expect(vi.mocked(notifyMissedCall).mock.calls[0]![1]).toMatchObject({
      recordAttemptsInBackground: true,
    });
  });
});
