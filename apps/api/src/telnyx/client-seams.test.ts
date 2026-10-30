/**
 * D142: the Telnyx client's seams and its destination gate.
 *
 * Every dial, transfer, text and verification code that goes through
 * `telnyxRequest` is judged here before a request exists; the census in
 * `environments/destination-gate.test.ts` proves no site goes around it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getEnv, type Env } from "../env";
import {
  RIG_DESTINATION_REFUSED,
  RIG_ENDPOINT_REFUSED,
  RIG_MESSAGING_PROFILE_DAILY_LIMIT,
} from "../environments/policy";
import {
  OWNED_A,
  OWNED_B,
  RIG_SUPABASE_URL,
  RIG_TELNYX_API_BASE,
  rigEnv,
  STRANGER,
} from "../test/rig-env";
import { completeEnv, stubFetch } from "../test/support";
import { TelnyxApiError, telnyxRequest, telnyxUpload, telnyxUrl } from "./client";
import { triggerBrandOtp } from "./registration";

interface Sent {
  url: string;
  body: unknown;
}

function recordTelnyx(): Sent[] {
  const sent: Sent[] = [];
  stubFetch(async (url, request) => {
    const json = request.headers.get("content-type") === "application/json";
    sent.push({ url: url.href, body: json ? await request.json() : undefined });
    return Response.json({ data: { id: "x" } });
  });
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the base URL", () => {
  it("is Telnyx when unset", () => {
    expect(telnyxUrl(getEnv(completeEnv()), "/v2/calls").href).toBe(
      "https://api.telnyx.com/v2/calls",
    );
  });

  it("keeps a base path, so the rig's prefix on the edge is not skipped", async () => {
    const sent = recordTelnyx();
    await telnyxRequest(getEnv(rigEnv()), { method: "GET", path: "/v2/phone_numbers" });
    // Uploads are porting paperwork, which the rig refuses, so the upload's
    // join is shown on a local base with the same shape.
    const prefixed = getEnv({ ...completeEnv(), TELNYX_API_BASE: "http://127.0.0.1:8791/g/telnyx" });
    await telnyxUpload(prefixed, {
      path: "/v2/documents",
      file: new Uint8Array([1]),
      filename: "a.pdf",
      contentType: "application/pdf",
    });
    expect(sent.map((s) => s.url)).toEqual([
      `${RIG_TELNYX_API_BASE}/v2/phone_numbers`,
      "http://127.0.0.1:8791/g/telnyx/v2/documents",
    ]);
  });

  it("tolerates a trailing slash on the override", () => {
    const env = getEnv({ ...completeEnv(), TELNYX_API_BASE: "http://127.0.0.1:8791/" });
    expect(telnyxUrl(env, "/v2/messages").href).toBe("http://127.0.0.1:8791/v2/messages");
  });
});

describe("the webhook and media seams", () => {
  const storage = "https://abcdefghijkl.supabase.co/storage/v1";

  it("send production's bodies exactly as built", async () => {
    const sent = recordTelnyx();
    const body = {
      webhook_url: "https://api.loonext.com/webhooks/telnyx",
      media_urls: [`${storage}/object/sign/mms/a.jpg?token=t`],
    };
    await telnyxRequest(getEnv(completeEnv()), {
      method: "POST",
      path: "/v2/messaging_profiles",
      body,
    });
    expect(sent[0].body).toEqual(body);
  });

  it("point every webhook field at TELNYX_WEBHOOK_URL", async () => {
    const sent = recordTelnyx();
    const env = getEnv({
      ...completeEnv(),
      TELNYX_WEBHOOK_URL: "https://edge.rig.internal/t/m",
    });
    await telnyxRequest(env, {
      method: "POST",
      path: "/v2/messaging_profiles",
      body: {
        name: "c",
        webhook_url: "https://api.loonext.com/webhooks/telnyx",
        webhook_failover_url: "https://api.loonext.com/webhooks/telnyx",
      },
    });
    await telnyxRequest(env, {
      method: "POST",
      path: "/v2/10dlc/brand",
      body: { webhookURL: "a", webhookFailoverURL: "b" },
    });
    expect(sent.map((s) => s.body)).toEqual([
      {
        name: "c",
        webhook_url: "https://edge.rig.internal/t/m",
        webhook_failover_url: "https://edge.rig.internal/t/m",
      },
      {
        webhookURL: "https://edge.rig.internal/t/m",
        webhookFailoverURL: "https://edge.rig.internal/t/m",
      },
    ]);
  });

  it("swap the storage prefix of a URL Telnyx fetches for the edge's media path", async () => {
    const sent = recordTelnyx();
    const env = getEnv(
      rigEnv({ TELNYX_MEDIA_PUBLIC_BASE: "https://edge.rig.internal/m/" }),
    );
    await telnyxRequest(env, {
      method: "POST",
      path: "/v2/calls/ccid-1/actions/playback_start",
      body: { audio_url: `${RIG_SUPABASE_URL}/storage/v1/object/sign/voicemail-greetings/g.mp3?token=t` },
    });
    await telnyxRequest(env, {
      method: "POST",
      path: "/v2/messages",
      body: {
        to: OWNED_A,
        media_urls: [
          `${RIG_SUPABASE_URL}/storage/v1/object/sign/mms/a.jpg?token=t`,
          "https://elsewhere.example.com/b.jpg",
        ],
      },
    });
    expect(sent.map((s) => s.body)).toEqual([
      {
        audio_url: "https://edge.rig.internal/m/object/sign/voicemail-greetings/g.mp3?token=t",
      },
      {
        to: OWNED_A,
        media_urls: [
          "https://edge.rig.internal/m/object/sign/mms/a.jpg?token=t",
          "https://elsewhere.example.com/b.jpg",
        ],
      },
    ]);
  });
});

describe("the destination gate in the client", () => {
  const cases: Array<[string, string, Record<string, unknown>]> = [
    ["a dial", "/v2/calls", { to: STRANGER, from: OWNED_A }],
    ["a simultaneous-ring dial", "/v2/calls", { to: [OWNED_B, STRANGER] }],
    ["a transfer", "/v2/calls/ccid-1/actions/transfer", { to: STRANGER }],
    ["a SIP REFER", "/v2/calls/ccid-1/actions/refer", { sip_address: "sip:+14165550199@example.com" }],
    ["a text", "/v2/messages", { to: STRANGER, from: OWNED_A, text: "hi" }],
    ["a long-code text", "/v2/messages/long_code", { to: STRANGER }],
    [
      "a hosted-number verification code",
      "/v2/messaging_hosted_number_orders/ho-1/verification_codes",
      { phone_numbers: [STRANGER] },
    ],
  ];

  it.each(cases)("refuses %s to a stranger on the rig, before any request", async (_l, path, body) => {
    const sent = recordTelnyx();
    const attempt = telnyxRequest(getEnv(rigEnv()), { method: "POST", path, body });
    await expect(attempt).rejects.toBeInstanceOf(TelnyxApiError);
    await attempt.catch((error: TelnyxApiError) => {
      expect(error.status).toBe(403);
      expect(error.hasCode(RIG_DESTINATION_REFUSED)).toBe(true);
    });
    expect(sent).toEqual([]);
  });

  it.each(cases)("sends %s unchanged outside the rig", async (_l, path, body) => {
    for (const env of [
      getEnv(completeEnv()),
      getEnv({ ...completeEnv(), DEPLOY_ENV: "production" }),
    ] satisfies Env[]) {
      const sent = recordTelnyx();
      await telnyxRequest(env, { method: "POST", path, body });
      expect(sent).toEqual([{ url: `https://api.telnyx.com${path}`, body }]);
      vi.unstubAllGlobals();
    }
  });

  it("lets the rig reach its own numbers and member credentials", async () => {
    const sent = recordTelnyx();
    const env = getEnv(rigEnv());
    await telnyxRequest(env, { method: "POST", path: "/v2/calls", body: { to: OWNED_B } });
    await telnyxRequest(env, {
      method: "POST",
      path: "/v2/calls",
      body: { to: "sip:gencredAAA@sip.telnyx.com" },
    });
    await telnyxRequest(env, {
      method: "POST",
      path: "/v2/calls/ccid-1/actions/hangup",
      body: {},
    });
    expect(sent).toHaveLength(3);
  });
});

/**
 * The rig's narrowing of messaging-profile writes lives in the environments
 * module, but it only protects anything if the client applies it to the body
 * that leaves. This is that half.
 */
describe("the messaging-profile limits in the client", () => {
  const asked = {
    name: "c",
    whitelisted_destinations: ["US", "CA", "GB"],
    daily_spend_limit: "250.00",
    daily_spend_limit_enabled: false,
  };

  it("cap what the rig sends Telnyx and keep US and Canada only", async () => {
    const sent = recordTelnyx();
    await telnyxRequest(getEnv(rigEnv()), {
      method: "POST",
      path: "/v2/messaging_profiles",
      body: asked,
    });
    expect(sent).toEqual([
      {
        url: `${RIG_TELNYX_API_BASE}/v2/messaging_profiles`,
        body: {
          name: "c",
          whitelisted_destinations: ["US", "CA"],
          daily_spend_limit: RIG_MESSAGING_PROFILE_DAILY_LIMIT,
          daily_spend_limit_enabled: true,
        },
      },
    ]);
  });

  it("leave production's profile exactly as built", async () => {
    const sent = recordTelnyx();
    await telnyxRequest(getEnv({ ...completeEnv(), DEPLOY_ENV: "production" }), {
      method: "POST",
      path: "/v2/messaging_profiles",
      body: asked,
    });
    expect(sent).toEqual([{ url: "https://api.telnyx.com/v2/messaging_profiles", body: asked }]);
  });
});

describe("the endpoints the guard never forwards, in the client", () => {
  const upload = {
    path: "/v2/documents",
    file: new Uint8Array([1]),
    filename: "a.pdf",
    contentType: "application/pdf",
  };

  async function expectRefused(attempt: Promise<unknown>): Promise<void> {
    await expect(attempt).rejects.toBeInstanceOf(TelnyxApiError);
    await attempt.catch((error: TelnyxApiError) => {
      expect(error.status).toBe(403);
      expect(error.hasCode(RIG_ENDPOINT_REFUSED)).toBe(true);
    });
  }

  it("are refused on the rig before any request, through either entry", async () => {
    const sent = recordTelnyx();
    const env = getEnv(rigEnv());
    await expectRefused(
      telnyxRequest(env, {
        method: "POST",
        path: "/v2/10dlc/brand",
        body: { entityType: "SOLE_PROPRIETOR", mobilePhone: STRANGER },
      }),
    );
    await expectRefused(telnyxRequest(env, { method: "POST", path: "/v2/10dlc/brand/b-1/smsOtp" }));
    await expectRefused(telnyxRequest(env, { method: "GET", path: "/v2/porting_orders/p-1" }));
    await expectRefused(telnyxUpload(env, upload));
    expect(sent).toEqual([]);
  });

  // The real site, since the OTP's target is the brand's stored mobile and
  // appears nowhere in the request for the destination gate to read.
  it("include a sole proprietor's OTP", async () => {
    const sent = recordTelnyx();
    await expectRefused(triggerBrandOtp(getEnv(rigEnv()), "brand-1"));
    expect(sent).toEqual([]);
    await triggerBrandOtp(getEnv({ ...completeEnv(), DEPLOY_ENV: "production" }), "brand-1");
    expect(sent.map((s) => s.url)).toEqual(["https://api.telnyx.com/v2/10dlc/brand/brand-1/smsOtp"]);
  });

  it("are sent outside the rig", async () => {
    const sent = recordTelnyx();
    const env = getEnv({ ...completeEnv(), DEPLOY_ENV: "production" });
    await telnyxRequest(env, { method: "POST", path: "/v2/10dlc/brand/b-1/smsOtp" });
    await telnyxUpload(env, upload);
    expect(sent.map((s) => s.url)).toEqual([
      "https://api.telnyx.com/v2/10dlc/brand/b-1/smsOtp",
      "https://api.telnyx.com/v2/documents",
    ]);
  });
});
