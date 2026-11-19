import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { captureException } from "../observability/capture";
import { restMatch, stubRoute } from "../test/messaging-support";
import { completeEnv, stubFetch } from "../test/support";
import { deleteTelnyxRecording } from "./inbound-ring";
import { handleVoicemailSaved } from "./voice-webhook";
import { sweepPendingVoicemails } from "./voicemail-recovery";

vi.mock("../observability/capture", () => ({ captureException: vi.fn() }));
vi.mock("./inbound-ring", () => ({ deleteTelnyxRecording: vi.fn() }));
vi.mock("./voice-webhook", () => ({ handleVoicemailSaved: vi.fn() }));

const env = completeEnv();
const SESSION_ID = "pending-voicemail";
const HOUR_MS = 3_600_000;

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.unstubAllGlobals());

function pendingCall(hoursAgo: number, ownsClaim = true) {
  const since = new Date(Date.now() - hoursAgo * HOUR_MS).toISOString();
  const row = {
    id: "11111111-1111-4111-8111-111111111111",
    call_session_id: SESSION_ID,
    voicemail_path: null,
    voicemail_pending_since: since,
    voicemail_pending_started_at: "2026-11-19T10:00:00.000Z",
    voicemail_pending_ended_at: "2026-11-19T10:00:20.000Z",
  };
  const lookup = stubRoute(restMatch(env, "GET", "calls"), () => [row]);
  const claim = stubRoute(
    restMatch(env, "PATCH", "calls", (url) => url.searchParams.has("or")),
    () => ownsClaim ? [{ id: row.id }] : [],
  );
  const clear = stubRoute(restMatch(env, "PATCH", "calls"), () => [{ id: row.id }]);
  stubFetch(lookup.route, claim.route, clear.route);
  return { row, lookup, claim, clear };
}

describe(sweepPendingVoicemails, () => {
  it("retries with the original recording times and clears the pending row", async () => {
    const { row, lookup, claim, clear } = pendingCall(1);
    const db = getDb(env);

    await sweepPendingVoicemails(env, db);

    expect(handleVoicemailSaved).toHaveBeenCalledExactlyOnceWith(env, db, {
      call_session_id: SESSION_ID,
      recording_started_at: row.voicemail_pending_started_at,
      recording_ended_at: row.voicemail_pending_ended_at,
    });
    expect(clear.calls[0]?.body).toMatchObject({ voicemail_pending_since: null });
    expect(clear.calls[0]?.url.searchParams.get("voicemail_pending_since"))
      .toBe(`eq.${row.voicemail_pending_since}`);
    expect(lookup.calls[0]?.url.searchParams.get("order")).toBe(
      "voicemail_pending_attempted_at.asc.nullsfirst,voicemail_pending_since.asc",
    );
    const claimBody = claim.calls[0]?.body as { voicemail_pending_attempted_at: string } | undefined;
    expect(clear.calls[0]?.url.searchParams.get("voicemail_pending_attempted_at"))
      .toBe(`eq.${claimBody?.voicemail_pending_attempted_at}`);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("keeps a pending call and its carrier recording when a retry fails", async () => {
    const { clear } = pendingCall(1);
    vi.mocked(handleVoicemailSaved).mockRejectedValueOnce(new Error("storage unavailable"));

    await sweepPendingVoicemails(env, getDb(env));

    expect(clear.calls).toHaveLength(0);
    expect(deleteTelnyxRecording).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("leaves a recording claimed by another sweep alone", async () => {
    const { clear } = pendingCall(1, false);

    await sweepPendingVoicemails(env, getDb(env));

    expect(handleVoicemailSaved).not.toHaveBeenCalled();
    expect(clear.calls).toHaveLength(0);
  });

  it("clears an exhausted recovery and reports its session once", async () => {
    const { clear } = pendingCall(25);

    await sweepPendingVoicemails(env, getDb(env));

    expect(handleVoicemailSaved).not.toHaveBeenCalled();
    expect(deleteTelnyxRecording).toHaveBeenCalledExactlyOnceWith(env, SESSION_ID);
    expect(clear.calls).toHaveLength(1);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(env, "voicemail recovery exhausted", {
      source: "cron",
      job: "job:sweep-stale-calls",
      extra: { call_session_id: SESSION_ID },
    });
  });
});
