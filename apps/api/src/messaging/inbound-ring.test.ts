import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import type { Env } from "../env";
import { restMatch, stubRoute, type Stub } from "../test/messaging-support";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { storeVoicemailRecording } from "./inbound-ring";

/**
 * Downloading a saved voicemail. A "not now" answer must keep Telnyx's copy
 * for the voicemail job's retry, and an expired link is tried once more from
 * a freshly signed one before the recording is given up on.
 */

const env: Env = completeEnv();
const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const NUMBER_ID = "dddddddd-0000-4000-8000-00000000000d";
const CALLER = "+16135551000";
const SESSION = "sess-1";
const WEBHOOK_LINK = "https://recordings.telnyx.example/rec-1.mp3";
const FRESH_LINK = "https://recordings.telnyx.example/rec-1-fresh.mp3";
const STARTED_AT = "2026-07-12T00:00:00Z";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function store(seconds = 42) {
  return storeVoicemailRecording(
    env,
    getDb(env),
    {
      call_session_id: SESSION,
      recording_urls: { mp3: WEBHOOK_LINK },
      recording_started_at: STARTED_AT,
      recording_ended_at: new Date(Date.parse(STARTED_AT) + seconds * 1000).toISOString(),
    },
    { companyId: COMPANY_ID, phoneNumberId: NUMBER_ID },
    CALLER,
  );
}

function link(href: string, status: number): Stub {
  return stubRoute(
    (url) => url.href === href,
    () =>
      status === 200
        ? new Response(new Uint8Array([73, 68, 51, 4]), { status })
        : new Response("refused", { status }),
  );
}

function listing(entries: Record<string, unknown>[]): Stub {
  return stubRoute(
    (url, request) => request.method === "GET" && url.pathname === "/v2/recordings",
    () => ({ data: entries }),
  );
}

function telnyxDelete(): Stub {
  return stubRoute(
    (url, request) =>
      request.method === "DELETE" && url.pathname.startsWith("/v2/recordings/"),
    () => ({ data: {} }),
  );
}

function storagePut(): Stub {
  return stubRoute(
    (url, request) =>
      request.method === "POST" &&
      url.pathname.startsWith("/storage/v1/object/voicemails/"),
    () => Response.json({ Key: "ok" }),
  );
}

function callsStamp(): Stub {
  return stubRoute(
    restMatch(env, "PATCH", "calls"),
    () => new Response(null, { status: 204 }),
  );
}

function serve(...stubs: Stub[]): void {
  stubFetch(...stubs.map((stub) => stub.route));
}

describe("storeVoicemailRecording: fetching the recording", () => {
  it.each([503, 429])(
    "a %i throws for the retry and keeps Telnyx's copy",
    async (status) => {
      const removal = telnyxDelete();
      const upload = storagePut();
      serve(link(WEBHOOK_LINK, status), listing([{ id: "rec-1" }]), removal, upload);

      await expect(store()).rejects.toThrow(`voicemail fetch transient: HTTP ${status}`);
      expect(removal.calls).toHaveLength(0);
      expect(upload.calls).toHaveLength(0);
    },
  );

  it("a download that hangs for 30s is abandoned for the retry and keeps Telnyx's copy", async () => {
    vi.useFakeTimers();
    const hung: FetchRoute = (url, request) =>
      url.href === WEBHOOK_LINK
        ? new Promise<Response>((_, reject) => {
            request.signal.addEventListener("abort", () => reject(request.signal.reason));
          })
        : undefined;
    const removal = telnyxDelete();
    stubFetch(hung, listing([{ id: "rec-1" }]).route, removal.route);

    const attempt = expect(store()).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(30_000);
    await attempt;
    expect(removal.calls).toHaveLength(0);
  });

  it.each([403, 404, 410])(
    "a %i is fetched again from a freshly signed link and stored, with Telnyx's copy kept",
    async (status) => {
      const expired = link(WEBHOOK_LINK, status);
      const fresh = link(FRESH_LINK, 200);
      const removal = telnyxDelete();
      const upload = storagePut();
      const stamp = callsStamp();
      serve(
        expired,
        fresh,
        listing([{ id: "rec-1", download_urls: { mp3: FRESH_LINK } }]),
        removal,
        upload,
        stamp,
      );

      const stored = await store();

      expect(stored).toEqual({
        companyId: COMPANY_ID,
        phoneNumberId: NUMBER_ID,
        callSessionId: SESSION,
        caller: CALLER,
        seconds: 42,
        transcript: null,
      });
      expect(expired.calls).toHaveLength(1);
      expect(fresh.calls).toHaveLength(1);
      expect(upload.calls[0]?.url.pathname).toBe(
        `/storage/v1/object/voicemails/${COMPANY_ID}/${SESSION}.mp3`,
      );
      expect(stamp.calls).toHaveLength(1);
      expect(removal.calls).toHaveLength(0);
    },
  );

  it("a 403 with no fresh link deletes Telnyx's copy and keeps nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const removal = telnyxDelete();
    const upload = storagePut();
    serve(link(WEBHOOK_LINK, 403), listing([{ id: "rec-1" }]), removal, upload);

    await expect(store()).resolves.toBeNull();
    expect(removal.calls.map((call) => call.url.pathname)).toEqual(["/v2/recordings/rec-1"]);
    expect(upload.calls).toHaveLength(0);
  });

  it("a 403 on the fresh link too deletes Telnyx's copy and keeps nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const removal = telnyxDelete();
    const upload = storagePut();
    serve(
      link(WEBHOOK_LINK, 403),
      link(FRESH_LINK, 403),
      listing([{ id: "rec-1", download_urls: { mp3: FRESH_LINK } }]),
      removal,
      upload,
    );

    await expect(store()).resolves.toBeNull();
    expect(removal.calls).toHaveLength(1);
    expect(upload.calls).toHaveLength(0);
  });

  it("a 503 on the fresh link throws for the retry and keeps Telnyx's copy", async () => {
    const removal = telnyxDelete();
    serve(
      link(WEBHOOK_LINK, 403),
      link(FRESH_LINK, 503),
      listing([{ id: "rec-1", download_urls: { mp3: FRESH_LINK } }]),
      removal,
    );

    await expect(store()).rejects.toThrow("voicemail fetch transient: HTTP 503");
    expect(removal.calls).toHaveLength(0);
  });

  it("a listing that fails for now throws for the retry and keeps Telnyx's copy", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const removal = telnyxDelete();
    const down = stubRoute(
      (url, request) => request.method === "GET" && url.pathname === "/v2/recordings",
      () => new Response("unavailable", { status: 503 }),
    );
    serve(link(WEBHOOK_LINK, 403), down, removal);

    await expect(store()).rejects.toMatchObject({ status: 503 });
    expect(down.calls).toHaveLength(1);
    expect(removal.calls).toHaveLength(0);
  });

  it("a listing Telnyx refuses counts as no fresh link and keeps nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const upload = storagePut();
    const refused = stubRoute(
      (url, request) => request.method === "GET" && url.pathname === "/v2/recordings",
      () => new Response("missing", { status: 404 }),
    );
    serve(link(WEBHOOK_LINK, 403), refused, upload);

    await expect(store()).resolves.toBeNull();
    expect(upload.calls).toHaveLength(0);
  });

  it("a recording under two seconds is never fetched and Telnyx's copy is deleted", async () => {
    const download = link(WEBHOOK_LINK, 200);
    const removal = telnyxDelete();
    serve(download, listing([{ id: "rec-1" }]), removal);

    await expect(store(1)).resolves.toBeNull();
    expect(download.calls).toHaveLength(0);
    expect(removal.calls).toHaveLength(1);
  });
});
