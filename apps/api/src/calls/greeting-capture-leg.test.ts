/**
 * #309 — the greeting-capture leg, from the owner picking up to the greeting
 * landing in their list.
 *
 * GL-4 is the one that decides whether any of this is safe. This leg is dialed
 * to a PSTN number by design, which is the one shape `outbound-leg-gate.ts`
 * treats as "nothing authorized this" — so the handler returning FALSE for a
 * tag it cannot verify is what hands an unauthorized leg back to that gate to
 * be hung up. A handler that served every `vgc`-prefixed leg would be an open
 * dial-anywhere endpoint with a cross-tenant write on the end of it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import type { Env } from "../env";
import { FakeRest } from "../telnyx/test-support";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";

import { buildGreetingCaptureState } from "./greeting-capture";
import { handleGreetingCaptureEvent } from "./greeting-capture-leg";

const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const CCID = "ccid-capture-1";
const SESSION = "sess-capture-1";
const RECORDING_URL = "https://recordings.telnyx.com/capture-1.mp3";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

interface TelnyxCall {
  path: string;
  method: string;
  body: Record<string, unknown>;
}

function buildHarness(
  extra: { greetings?: Record<string, unknown>[]; audioBytes?: number } = {},
) {
  const env = completeEnv();
  const rest = new FakeRest(env);
  rest.table("companies");
  rest.table("voicemail_greetings", {}, [["company_id", "name"]]);
  rest.insert("companies", { id: COMPANY_ID, name: "Acme Plumbing" });
  for (const greeting of extra.greetings ?? []) {
    rest.insert("voicemail_greetings", { company_id: COMPANY_ID, ...greeting });
  }

  const telnyx: TelnyxCall[] = [];
  const telnyxRoute: FetchRoute = async (url, request) => {
    if (url.origin !== "https://api.telnyx.com") return undefined;
    telnyx.push({
      path: url.pathname,
      method: request.method,
      body: request.method === "POST"
        ? ((await request.json().catch(() => ({}))) as Record<string, unknown>)
        : {},
    });
    // The recording-delete sweep lists first, then deletes each id.
    if (url.pathname === "/v2/recordings") {
      return Response.json({ data: [{ id: "rec-1" }] });
    }
    return Response.json({ data: {} });
  };

  const uploads: string[] = [];
  const removed: string[] = [];
  const storageRoute: FetchRoute = (url, request) => {
    if (!url.pathname.includes("/storage/v1/object")) return undefined;
    if (request.method === "POST") {
      uploads.push(url.pathname);
      return Response.json({ Key: url.pathname });
    }
    if (request.method === "DELETE") {
      removed.push(url.pathname);
      return Response.json([]);
    }
    return undefined;
  };

  const audioRoute: FetchRoute = (url) => {
    if (url.href !== RECORDING_URL) return undefined;
    return new Response(new Uint8Array(extra.audioBytes ?? 4096), {
      headers: { "Content-Type": "audio/mpeg" },
    });
  };

  stubFetch(telnyxRoute, audioRoute, storageRoute, rest.route());
  return { env, rest, telnyx, uploads, removed };
}

/** A recording payload spanning `seconds` of speech. */
function savedPayload(clientState: string, seconds: number) {
  const started = new Date("2026-08-04T10:00:00.000Z");
  return {
    call_control_id: CCID,
    call_session_id: SESSION,
    client_state: clientState,
    recording_urls: { mp3: RECORDING_URL },
    recording_started_at: started.toISOString(),
    recording_ended_at: new Date(started.getTime() + seconds * 1000).toISOString(),
  };
}

async function tagFor(env: Env, name = "After hours"): Promise<string> {
  return buildGreetingCaptureState(env, COMPANY_ID, name, Date.now());
}

describe("#309 the greeting-capture leg", () => {
  it("GL-1: answering speaks a prompt that names the business", async () => {
    const harness = buildHarness();
    const tag = await tagFor(harness.env);
    const handled = await handleGreetingCaptureEvent(
      harness.env,
      getDb(harness.env),
      "call.answered",
      { call_control_id: CCID, client_state: tag },
    );
    expect(handled).toBe(true);
    const speak = harness.telnyx.find((call) => call.path.endsWith("/speak"));
    expect(speak).toBeDefined();
    // The first second of an unexpected call is spent deciding whether it is a
    // robocall — and this one IS a synthetic voice ringing out of the blue.
    expect(String(speak!.body.payload)).toContain("Acme Plumbing");
    // The tag rides on, so the speak's own `speak.ended` is still a capture leg.
    expect(speak!.body.client_state).toBe(tag);
  });

  it("GL-2: the prompt ending starts the recording, with the beep and both caps", async () => {
    const harness = buildHarness();
    const tag = await tagFor(harness.env);
    await handleGreetingCaptureEvent(
      harness.env,
      getDb(harness.env),
      "call.speak.ended",
      { call_control_id: CCID, client_state: tag },
    );
    const record = harness.telnyx.find((call) =>
      call.path.endsWith("/record_start"),
    );
    expect(record).toBeDefined();
    expect(record!.body.play_beep).toBe(true);
    // The column's own ceiling, so nothing longer can ever reach the insert.
    expect(record!.body.max_length).toBe(120);
    // And an ending for the owner who stops talking and waits rather than
    // hanging up — both endings produce the same call.recording.saved.
    expect(record!.body.timeout_secs).toBe(10);
  });

  it("GL-3: a saved recording becomes a greeting, and the Telnyx copy goes", async () => {
    const harness = buildHarness();
    const tag = await tagFor(harness.env);
    await handleGreetingCaptureEvent(
      harness.env,
      getDb(harness.env),
      "call.recording.saved",
      savedPayload(tag, 9),
    );

    expect(harness.uploads).toHaveLength(1);
    const rows = harness.rest.rows("voicemail_greetings");
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("After hours");
    expect(rows[0].duration_ms).toBe(9000);
    expect(rows[0].mime_type).toBe("audio/mpeg");
    expect(String(rows[0].storage_path)).toContain(`voicemail-greetings/${COMPANY_ID}/`);

    // Our copy is the copy. A recording of the business's own voice does not
    // stay on a third party once we hold it.
    expect(
      harness.telnyx.some(
        (call) => call.method === "DELETE" && call.path.startsWith("/v2/recordings/"),
      ),
    ).toBe(true);
    // And the leg is finished either way — the owner who waited in silence is
    // not left holding an open line.
    expect(harness.telnyx.some((call) => call.path.endsWith("/hangup"))).toBe(true);
  });

  it("GL-4: a leg we did not authorize is not served", async () => {
    // THE ONE THAT MATTERS. Returning false is what hands this leg back to the
    // outgoing-leg gate, which hangs up a PSTN leg nobody authorized. Serving
    // it instead would make `vgc` an open dial-anywhere tag with a write into
    // whichever workspace it named on the end of it.
    const harness = buildHarness();
    const forged = btoa(`vgc|${"a".repeat(32)}|${COMPANY_ID}|${Date.now() + 60_000}|Hijack`);

    for (const eventType of [
      "call.answered",
      "call.speak.ended",
      "call.recording.saved",
    ]) {
      const handled = await handleGreetingCaptureEvent(
        harness.env,
        getDb(harness.env),
        eventType,
        savedPayload(forged, 9),
      );
      expect(handled).toBe(false);
    }
    // Nothing spoken, nothing recorded, nothing written.
    expect(harness.telnyx).toHaveLength(0);
    expect(harness.uploads).toHaveLength(0);
    expect(harness.rest.rows("voicemail_greetings")).toHaveLength(0);
  });

  it("GL-5: a hangup on the beep writes nothing", async () => {
    const harness = buildHarness();
    const tag = await tagFor(harness.env);
    await handleGreetingCaptureEvent(
      harness.env,
      getDb(harness.env),
      "call.recording.saved",
      savedPayload(tag, 1),
    );
    expect(harness.uploads).toHaveLength(0);
    expect(harness.rest.rows("voicemail_greetings")).toHaveLength(0);
    // The stray Telnyx recording still goes, though — it is a second of the
    // owner's voice sitting on somebody else's disk.
    expect(
      harness.telnyx.some(
        (call) => call.method === "DELETE" && call.path.startsWith("/v2/recordings/"),
      ),
    ).toBe(true);
  });

  it("GL-6: a name already taken is discarded, never written over", async () => {
    // The call is over by the time we know, so there is nobody to ask — and
    // silently replacing a greeting the owner did not ask us to touch is the
    // worse of the two answers.
    const harness = buildHarness({
      greetings: [{ id: "g-1", name: "After hours" }],
    });
    const tag = await tagFor(harness.env);
    await handleGreetingCaptureEvent(
      harness.env,
      getDb(harness.env),
      "call.recording.saved",
      savedPayload(tag, 9),
    );
    // One greeting, and it is the one that was already there.
    const rows = harness.rest.rows("voicemail_greetings");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("g-1");
    // And the bytes that were uploaded before the insert failed are taken back
    // out — an object nothing references is waste nothing would ever notice.
    expect(harness.uploads).toHaveLength(1);
    expect(harness.removed).toHaveLength(1);
  });

  it("GL-7: an expired tag is refused as firmly as a forged one", async () => {
    const harness = buildHarness();
    const stale = await buildGreetingCaptureState(
      harness.env,
      COMPANY_ID,
      "After hours",
      Date.now() - 10 * 60_000,
    );
    const handled = await handleGreetingCaptureEvent(
      harness.env,
      getDb(harness.env),
      "call.recording.saved",
      savedPayload(stale, 9),
    );
    expect(handled).toBe(false);
    expect(harness.rest.rows("voicemail_greetings")).toHaveLength(0);
  });
});
