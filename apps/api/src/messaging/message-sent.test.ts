/**
 * D146: every submit to Telnyx sends one `message_sent` under the workspace,
 * accepted or refused, with the destination's country, the segments the send
 * was metered at and how many media items it carried. Never the number.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchOutbound } from "./send";
import type { MessageRow } from "./types";
import { getDb } from "../db";
import { getEnv, type Env } from "../env";
import { ApiError } from "../http/errors";
import { eventsCaptured, resetCaptures } from "../test/capture-mock";
import { messageRow, restMatch, stubRoute } from "../test/messaging-support";
import { clearedFor, completeEnv, stubFetch } from "../test/support";

vi.mock("../observability/capture", async () =>
  (await import("../test/capture-mock")).captureModuleMock(),
);

const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const MESSAGE_ID = "aaaaaaaa-0000-4000-8000-00000000000a";

const isTelnyxSend = (url: URL, request: Request) =>
  request.method === "POST" && url.href === "https://api.telnyx.com/v2/messages";

function queued(overrides: Partial<MessageRow> = {}): MessageRow {
  return messageRow({ id: MESSAGE_ID, company_id: COMPANY_ID, ...overrides });
}

function sendArgs(to: string, mediaUrls: string[] = []) {
  return { from: "+16135550100", to, text: "On our way!", mediaUrls, clearance: clearedFor(to) };
}

/**
 * Telnyx answers with `telnyx`, and every database call the send makes
 * succeeds. The row update echoes the row it was given, as PostgREST does.
 */
function serve(env: Env, telnyx: () => Response, row: MessageRow = queued()) {
  const send = stubRoute(isTelnyxSend, telnyx);
  const persist = stubRoute(restMatch(env, "PATCH", "messages"), (call) => [
    { ...row, ...(call.body as Record<string, unknown>) },
  ]);
  const database = stubRoute((url) => url.href.startsWith(env.SUPABASE_URL), () => []);
  stubFetch(send.route, persist.route, database.route);
  return send;
}

function sent() {
  return eventsCaptured("message_sent");
}

beforeEach(() => {
  resetCaptures();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("message_sent", () => {
  it("an accepted text carries its country, segments and media count", async () => {
    const env = getEnv(completeEnv());
    const mms = queued({ segments: 3 });
    serve(env, () => Response.json({ data: { id: "40385f64-5717-4562-b3fc-2c963f66dddd" } }), mms);

    await dispatchOutbound(
      env,
      getDb(env),
      mms,
      sendArgs("+12125550100", ["https://example.test/a.jpg", "https://example.test/b.jpg"]),
    );

    expect(sent()).toEqual([
      {
        event: "message_sent",
        distinctId: COMPANY_ID,
        properties: {
          direction: "outbound",
          status: "accepted",
          country: "US",
          segments: 3,
          media_count: 2,
        },
      },
    ]);
  });

  it("a text Telnyx refuses carries the provider's code and our reason for it", async () => {
    const env = getEnv(completeEnv());
    serve(env, () =>
      Response.json({ errors: [{ code: "40002", title: "Blocked as spam" }] }, { status: 400 }),
    );

    await dispatchOutbound(env, getDb(env), queued(), sendArgs("+16135551000"));

    expect(sent().map((entry) => entry.properties)).toEqual([
      {
        direction: "outbound",
        status: "refused",
        error_code: "40002",
        reason: "content_blocked",
        country: "CA",
        segments: 1,
        media_count: 0,
      },
    ]);
  });

  it("a send that never reached Telnyx is refused with no code", async () => {
    const env = getEnv(completeEnv());
    serve(env, () => {
      throw new TypeError("fetch failed");
    });

    await dispatchOutbound(env, getDb(env), queued(), sendArgs("+16135551000"));

    expect(sent().map((entry) => entry.properties)).toMatchObject([
      { status: "refused", error_code: null, reason: "unknown" },
    ]);
  });

  it("a send our rate limiter stops is refused as rate_limited, and Telnyx is never asked", async () => {
    const env = {
      ...getEnv(completeEnv()),
      SEND_RATE_LIMITER: { limit: async () => ({ success: false }) },
    } as Env;
    const telnyx = serve(env, () => Response.json({ data: { id: "unused" } }));

    await expect(
      dispatchOutbound(env, getDb(env), queued(), sendArgs("+16135551000")),
    ).rejects.toBeInstanceOf(ApiError);

    expect(telnyx.calls).toHaveLength(0);
    expect(sent().map((entry) => entry.properties)).toEqual([
      {
        direction: "outbound",
        status: "refused",
        error_code: "rate_limited",
        reason: "rate_limited",
        country: "CA",
        segments: 1,
        media_count: 0,
      },
    ]);
  });
});
