/**
 * #642: Telnyx's own daily spend limit on a messaging profile, seen from the
 * send path.
 *
 * A send the cap refuses answers HTTP 429 with code 40333. It must stay an
 * ordinary failed send for the customer, and become its own notice for the
 * operator instead of one more generic failure, sent on the day's first
 * refusal only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchOutbound } from "./send";
import { dispatchTelnyxEvent } from "./dispatch";
import { getDb } from "../db";
import { getEnv } from "../env";
import { captured, noticesCaptured, resetCaptures } from "../test/capture-mock";
import { messageRow, restMatch, stubRoute } from "../test/messaging-support";
import { clearedFor, completeEnv, stubFetch } from "../test/support";

vi.mock("../observability/capture", async () =>
  (await import("../test/capture-mock")).captureModuleMock(),
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
  resetCaptures();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function refuse(code: string, status: number, refusedEarlierToday: { id: string }[] = []) {
  const env = getEnv(completeEnv());
  const telnyx = stubRoute(isTelnyxSend, () =>
    Response.json(
      { errors: [{ code, title: "Refused", detail: "The profile's daily spend limit was reached." }] },
      { status },
    ),
  );
  const persist = stubRoute(restMatch(env, "PATCH", "messages"), (call) => [
    messageRow({ id: MESSAGE_ID, company_id: COMPANY_ID, ...(call.body as Record<string, unknown>) }),
  ]);
  const earlier = stubRoute(restMatch(env, "GET", "messages"), () => refusedEarlierToday);
  stubFetch(telnyx.route, persist.route, earlier.route);
  return { env, persist };
}

const send = (env: ReturnType<typeof getEnv>) =>
  dispatchOutbound(env, getDb(env), messageRow({ id: MESSAGE_ID, company_id: COMPANY_ID }), SEND_ARGS);

describe("a send refused with 40333", () => {
  it("is still an honest failed message on the thread", async () => {
    const { env, persist } = refuse("40333", 429);

    const row = await send(env);

    expect(row.status).toBe("failed");
    expect(persist.calls[0].body).toMatchObject({ status: "failed", error_code: "40333" });
  });

  it("sends one notice naming the workspace when it is the day's first refusal", async () => {
    const { env } = refuse("40333", 429);

    await send(env);

    const notices = noticesCaptured("telnyx-messaging-spend-cap");
    expect(notices).toHaveLength(1);
    expect(notices[0].level).toBe("error");
    expect(notices[0].detail).toContain(`company ${COMPANY_ID}`);
  });

  it("sends nothing when a send was already refused today", async () => {
    const { env } = refuse("40333", 429, [{ id: "earlier" }]);

    await send(env);

    expect(noticesCaptured()).toEqual([]);
  });

  it("is not sent for other refusals", async () => {
    const { env } = refuse("40310", 400);

    await send(env);

    expect(noticesCaptured("telnyx-messaging-spend-cap")).toEqual([]);
  });
});

describe("the messaging-profile.spend-limit-reached webhook", () => {
  it("is acknowledged and does nothing: Telnyx emails the account owner itself", async () => {
    const env = getEnv(completeEnv());
    const requests: string[] = [];
    stubFetch(async (url, request) => {
      requests.push(`${request.method} ${url.pathname}`);
      return undefined;
    });

    await dispatchTelnyxEvent(env, {
      data: {
        event_type: "messaging-profile.spend-limit-reached",
        payload: { messaging_profile_id: "profile-1" },
      },
    });

    expect(requests).toEqual([]);
    expect(captured).toEqual([]);
  });
});
