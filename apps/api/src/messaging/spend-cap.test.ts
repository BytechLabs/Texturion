/**
 * #642: Telnyx's own daily spend limit on a messaging profile, seen from the
 * send path and from the webhook.
 *
 * A send the cap refuses answers HTTP 429 with code 40333. It must stay an
 * ordinary failed send for the customer, and become its own grouped signal for
 * the operator instead of one more generic failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchOutbound } from "./send";
import { dispatchTelnyxEvent } from "./dispatch";
import { getDb } from "../db";
import { resetSpendCapThrottle } from "../observability/telnyx-spend";
import { messageRow, restMatch, stubRoute } from "../test/messaging-support";
import { opsCaptures, resetSentryCaptures } from "../test/sentry-mock";
import { clearedFor, completeEnv, stubFetch } from "../test/support";

vi.mock("@sentry/cloudflare", async () =>
  (await import("../test/sentry-mock")).sentryModuleMock(),
);

const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const MESSAGE_ID = "aaaaaaaa-0000-4000-8000-00000000000a";

const SEND_ARGS = {
  from: "+16135550100",
  to: "+16135551000",
  text: "On our way!",
  mediaUrls: [] as string[],
  clearance: clearedFor("+16135551000"),
};

const isTelnyxSend = (url: URL, request: Request) =>
  request.method === "POST" && url.href === "https://api.telnyx.com/v2/messages";

beforeEach(() => {
  resetSentryCaptures();
  resetSpendCapThrottle();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function refuse(code: string, status: number) {
  const env = completeEnv();
  const telnyx = stubRoute(isTelnyxSend, () =>
    Response.json(
      { errors: [{ code, title: "Refused", detail: "The profile's daily spend limit was reached." }] },
      { status },
    ),
  );
  const persist = stubRoute(restMatch(env, "PATCH", "messages"), (call) => [
    messageRow({ id: MESSAGE_ID, company_id: COMPANY_ID, ...(call.body as Record<string, unknown>) }),
  ]);
  stubFetch(telnyx.route, persist.route);
  return { env, persist };
}

describe("a send refused with 40333", () => {
  it("is still an honest failed message on the thread", async () => {
    const { env, persist } = refuse("40333", 429);

    const row = await dispatchOutbound(
      env,
      getDb(env),
      messageRow({ id: MESSAGE_ID, company_id: COMPANY_ID }),
      SEND_ARGS,
    );

    expect(row.status).toBe("failed");
    expect(persist.calls[0].body).toMatchObject({ status: "failed", error_code: "40333" });
  });

  it("raises its own ops signal, naming the workspace", async () => {
    const { env } = refuse("40333", 429);

    await dispatchOutbound(
      env,
      getDb(env),
      messageRow({ id: MESSAGE_ID, company_id: COMPANY_ID }),
      SEND_ARGS,
    );

    const [alert] = opsCaptures("telnyx-messaging-spend-cap");
    expect(alert.fingerprint).toEqual(["ops", "telnyx-messaging-spend-cap"]);
    expect(alert.level).toBe("error");
    expect(String(alert.extra.detail)).toContain(`company ${COMPANY_ID}`);
  });

  it("is not raised for other refusals", async () => {
    const { env } = refuse("40310", 400);

    await dispatchOutbound(
      env,
      getDb(env),
      messageRow({ id: MESSAGE_ID, company_id: COMPANY_ID }),
      SEND_ARGS,
    );

    expect(opsCaptures("telnyx-messaging-spend-cap")).toEqual([]);
  });
});

describe("the messaging-profile.spend-limit-reached webhook", () => {
  it("raises the same signal and writes nothing", async () => {
    const env = completeEnv();
    const writes: string[] = [];
    stubFetch(async (url, request) => {
      if (url.host === "api.resend.com") return Response.json({ id: "email-1" });
      if (url.pathname === "/rest/v1/companies") return Response.json([{ id: COMPANY_ID }]);
      if (request.method !== "GET") writes.push(`${request.method} ${url.pathname}`);
      return undefined;
    });

    await dispatchTelnyxEvent(env, {
      data: {
        event_type: "messaging-profile.spend-limit-reached",
        payload: { messaging_profile_id: "profile-1" },
      },
    });

    const [alert] = opsCaptures("telnyx-messaging-spend-cap");
    expect(String(alert.extra.detail)).toContain(`company ${COMPANY_ID}`);
    expect(writes.filter((line) => !line.includes("record_heartbeat"))).toEqual([]);
  });
});
