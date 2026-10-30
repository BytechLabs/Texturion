/**
 * D142: rig mode may only ADD restrictions, production gains exactly two
 * start-up refusals, and local refuses only what says it is really the rig.
 * Everything here is driven through the real env schema
 * (`getEnv`), so a refusal that the schema never reaches is a failing test.
 */
import { describe, expect, it } from "vitest";

import { getEnv, type Env } from "../env";
import { sentryOptions } from "../observability/sentry";
import { completeEnv } from "../test/support";
import { deployEnv } from "./mode";
import * as policy from "./policy";
import {
  customerWebhookRefusal,
  deployPostureRefusals,
  fcmCredential,
  inboundCallerRefusal,
  liveStripeEventRefusal,
  outboundDestinationRefusal,
  restrictTelnyxBody,
  RIG_DESTINATION_REFUSED,
  RIG_MESSAGING_PROFILE_DAILY_LIMIT,
  sentryEnvironment,
  servesRigRoutes,
  telnyxRequestRefusal,
} from "./policy";
import { OWNED_A, OWNED_B, rigEnv, STRANGER } from "../test/rig-env";

describe("DEPLOY_ENV", () => {
  it("unset is local", () => {
    expect(deployEnv(getEnv(completeEnv()))).toBe("local");
  });

  it("accepts the three names and nothing else", () => {
    for (const name of ["local", "rig", "production"] as const) {
      const env = name === "rig" ? rigEnv() : { ...completeEnv(), DEPLOY_ENV: name };
      expect(deployEnv(getEnv(env))).toBe(name);
    }
    expect(() => getEnv({ ...completeEnv(), DEPLOY_ENV: "staging" })).toThrowError(
      /DEPLOY_ENV/,
    );
    expect(() => getEnv({ ...completeEnv(), DEPLOY_ENV: "" })).toThrowError(/DEPLOY_ENV/);
  });
});

describe("production's start-up refusals", () => {
  const production = (overrides: Record<string, unknown> = {}) => ({
    ...completeEnv(),
    DEPLOY_ENV: "production",
    ...overrides,
  });

  it("boots with production's configuration", () => {
    expect(() => getEnv(production())).not.toThrow();
  });

  it("refuses TELNYX_API_BASE, naming the variable", () => {
    expect(() =>
      getEnv(production({ TELNYX_API_BASE: "http://127.0.0.1:8791" })),
    ).toThrowError(/TELNYX_API_BASE/);
  });

  it.each([
    ["TELNYX_WEBHOOK_URL", "https://edge.example/webhooks/telnyx"],
    ["TELNYX_MEDIA_PUBLIC_BASE", "https://edge.example/media"],
    ["STRIPE_API_BASE", "http://127.0.0.1:8792"],
    ["RESEND_API_BASE", "https://edge.example"],
    ["FCM_API_BASE", "https://edge.example"],
    ["FCM_OAUTH_TOKEN_URL", "https://edge.example/token"],
  ])("refuses %s, which would redirect a vendor's traffic", (name, value) => {
    expect(() => getEnv(production({ [name]: value }))).toThrowError(new RegExp(name));
  });

  it("refuses a database on the rig or on loopback", () => {
    expect(() =>
      getEnv(production({ SUPABASE_URL: "https://db.rig.internal" })),
    ).toThrowError(/SUPABASE_URL/);
    expect(() =>
      getEnv(production({ SUPABASE_URL: "http://127.0.0.1:54321" })),
    ).toThrowError(/SUPABASE_URL/);
  });

  it("is the only mode that refuses TELNYX_API_BASE: local keeps the e2e seam", () => {
    const local = getEnv({ ...completeEnv(), TELNYX_API_BASE: "http://127.0.0.1:8791" });
    expect(deployEnv(local)).toBe("local");
  });
});

/**
 * Unset means local, so a rig configuration missing its DEPLOY_ENV line would
 * otherwise boot with every rig gate switched off and nothing saying so.
 */
describe("local's start-up refusals: a rig configuration without its flag", () => {
  function withoutFlag(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const bindings: Record<string, unknown> = { ...rigEnv(), ...overrides };
    delete bindings.DEPLOY_ENV;
    return bindings;
  }

  it("refuses the rig's whole configuration, naming why", () => {
    expect(() => getEnv(withoutFlag())).toThrowError(/RIG_OWNED_E164.*DEPLOY_ENV is not rig/);
  });

  it.each([
    ["RIG_OWNED_E164", { RIG_OWNED_E164: OWNED_A }],
    ["RIG_ROBOT_WEBHOOK_ORIGIN", { RIG_ROBOT_WEBHOOK_ORIGIN: "https://robot.rig.internal" }],
    ["SUPABASE_URL", { SUPABASE_URL: "https://db.rig.internal" }],
    [
      "SUPABASE_JWKS_URL",
      { SUPABASE_JWKS_URL: "https://db.rig.internal/auth/v1/.well-known/jwks.json" },
    ],
    ["APP_ORIGIN", { APP_ORIGIN: "https://app.rig.internal" }],
  ])("refuses %s on its own", (name, overrides) => {
    expect(() => getEnv({ ...completeEnv(), ...overrides })).toThrowError(new RegExp(name));
  });

  it("boots a laptop, CI and the e2e harness, which carry none of it", () => {
    expect(deployPostureRefusals(getEnv(completeEnv()))).toEqual([]);
    expect(
      deployPostureRefusals(
        getEnv({
          ...completeEnv(),
          SUPABASE_URL: "http://127.0.0.1:54321",
          TELNYX_API_BASE: "http://127.0.0.1:8791",
        }),
      ),
    ).toEqual([]);
  });

  it("leaves production alone: there the flag is stamped, and a stray variable is unread", () => {
    expect(() =>
      getEnv({ ...completeEnv(), DEPLOY_ENV: "production", RIG_OWNED_E164: OWNED_A }),
    ).not.toThrow();
  });
});

describe("rig mode's start-up refusals", () => {
  it("boots with a rig configuration", () => {
    expect(deployPostureRefusals(getEnv(rigEnv()))).toEqual([]);
  });

  it.each([
    ["SUPABASE_URL", { SUPABASE_URL: "https://abcdefghijkl.supabase.co" }],
    ["SUPABASE_URL", { SUPABASE_URL: "https://db.rig.internal.example.com" }],
    [
      "SUPABASE_JWKS_URL",
      { SUPABASE_JWKS_URL: "https://abcdefghijkl.supabase.co/auth/v1/.well-known/jwks.json" },
    ],
    // Shaped like a live key without being one a secret scanner would flag.
    ["STRIPE_SECRET_KEY", { STRIPE_SECRET_KEY: "sk_live_not_a_real_key" }],
    ["STRIPE_SECRET_KEY", { STRIPE_SECRET_KEY: "rk_live_not_a_real_key" }],
    ["TELNYX_API_KEY", { TELNYX_API_KEY: "KEY0123456789ABCDEF_abcdefgh" }],
    ["TELNYX_API_BASE", { TELNYX_API_BASE: undefined }],
    ["TELNYX_API_BASE", { TELNYX_API_BASE: "https://api.telnyx.com" }],
    ["RESEND_API_BASE", { RESEND_API_BASE: undefined }],
    ["RESEND_API_BASE", { RESEND_API_BASE: "https://api.resend.com" }],
    ["FCM_API_BASE", { FCM_API_BASE: undefined }],
    ["FCM_API_BASE", { FCM_API_BASE: "https://fcm.googleapis.com" }],
    ["FCM_OAUTH_TOKEN_URL", { FCM_OAUTH_TOKEN_URL: undefined }],
    ["FCM_OAUTH_TOKEN_URL", { FCM_OAUTH_TOKEN_URL: "https://oauth2.googleapis.com/token" }],
    ["TELNYX_BILLING_GROUP_ID", { TELNYX_BILLING_GROUP_ID: undefined }],
  ])("refuses a wrong %s", (name, overrides) => {
    const bindings: Record<string, unknown> = { ...rigEnv(), ...overrides };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete bindings[key];
    }
    expect(() => getEnv(bindings)).toThrowError(new RegExp(name));
  });

  it("names variables, never their values", () => {
    const secret = "sk_live_do_not_echo_0123456789";
    let message = "";
    try {
      getEnv({ ...rigEnv(), STRIPE_SECRET_KEY: secret });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/STRIPE_SECRET_KEY/);
    expect(message).not.toContain(secret);
  });
});

/**
 * Every export, and what proves it inert outside the rig. A new export must
 * be added here, which is the point: the question "what does production get?"
 * has to be answered for it before it ships.
 */
const INERT_OUTSIDE_RIG: Record<string, ((env: Env) => void) | "constant"> = {
  deployPostureRefusals: (env) => {
    if (deployEnv(env) === "local") expect(deployPostureRefusals(env)).toEqual([]);
  },
  sentryEnvironment: (env) => {
    expect(sentryEnvironment(env)).toBe(
      deployEnv(env) === "production" ? "production" : "development",
    );
  },
  servesRigRoutes: (env) => expect(servesRigRoutes(env)).toBe(false),
  fcmCredential: (env) => expect(fcmCredential(env)).toEqual({ kind: "google" }),
  outboundDestinationRefusal: (env) => {
    expect(outboundDestinationRefusal(env, STRANGER)).toBeNull();
    expect(outboundDestinationRefusal(env, "sip:+14165550199@sip.telnyx.com")).toBeNull();
  },
  inboundCallerRefusal: (env) => {
    expect(inboundCallerRefusal(env, STRANGER)).toBeNull();
    expect(inboundCallerRefusal(env, null)).toBeNull();
  },
  liveStripeEventRefusal: (env) => {
    expect(liveStripeEventRefusal(env, { livemode: true })).toBeNull();
    expect(liveStripeEventRefusal(env, {})).toBeNull();
  },
  customerWebhookRefusal: (env) => {
    expect(customerWebhookRefusal(env, "https://hooks.example.com/x")).toBeNull();
  },
  restrictTelnyxBody: (env) => {
    const body = { name: "c", whitelisted_destinations: ["US", "CA", "GB"] };
    expect(restrictTelnyxBody(env, { method: "POST", path: "/v2/messaging_profiles" }, body)).toBe(
      body,
    );
  },
  telnyxRequestRefusal: (env) => {
    expect(telnyxRequestRefusal(env, { path: "/v2/10dlc/brand/b-1/smsOtp" })).toBeNull();
    expect(telnyxRequestRefusal(env, { path: "/v2/porting_orders" })).toBeNull();
  },
  RIG_DESTINATION_REFUSED: "constant",
  RIG_ENDPOINT_REFUSED: "constant",
  RIG_MESSAGING_PROFILE_DAILY_LIMIT: "constant",
};

describe("outside the rig, every policy answer is the permissive one", () => {
  it("classifies every export of the module", () => {
    expect(Object.keys(policy).sort()).toEqual(Object.keys(INERT_OUTSIDE_RIG).sort());
  });

  it.each([
    ["local", () => getEnv(completeEnv())],
    ["production", () => getEnv({ ...completeEnv(), DEPLOY_ENV: "production" })],
  ])("%s", (_name, build) => {
    const env = build();
    for (const check of Object.values(INERT_OUTSIDE_RIG)) {
      if (check !== "constant") check(env);
    }
  });
});

describe("the rig's outbound destination gate", () => {
  const env = () => getEnv(rigEnv());

  it("lets the partition's numbers through", () => {
    expect(outboundDestinationRefusal(env(), OWNED_A)).toBeNull();
    expect(outboundDestinationRefusal(env(), ` ${OWNED_B} `)).toBeNull();
  });

  it("lets a member credential through", () => {
    expect(outboundDestinationRefusal(env(), "sip:gencredAAA@sip.telnyx.com")).toBeNull();
  });

  it.each([
    ["a number outside the partition", STRANGER],
    ["a phone number in a SIP costume", "sip:+14165550199@sip.telnyx.com"],
    ["a host that merely contains Telnyx's", "sip:gencredAAA@sip.telnyx.com.attacker.example"],
    ["an empty destination", ""],
  ])("refuses %s", (_label, destination) => {
    expect(outboundDestinationRefusal(env(), destination)).toEqual({
      code: RIG_DESTINATION_REFUSED,
      detail: expect.any(String),
    });
  });

  it("refuses everything when the allowlist is unset", () => {
    const bindings: Record<string, unknown> = { ...rigEnv() };
    delete bindings.RIG_OWNED_E164;
    expect(outboundDestinationRefusal(getEnv(bindings), OWNED_A)).not.toBeNull();
  });

  it("never writes the number into the refusal, which is persisted and logged", () => {
    const refusal = outboundDestinationRefusal(env(), STRANGER);
    expect(refusal?.detail).not.toMatch(/\d{4}/);
  });
});

describe("the rig's inbound gate", () => {
  const env = () => getEnv(rigEnv());

  it("admits the partition's numbers and member credentials", () => {
    expect(inboundCallerRefusal(env(), OWNED_A)).toBeNull();
    expect(inboundCallerRefusal(env(), "sip:gencredAAA@sip.telnyx.com")).toBeNull();
  });

  it("refuses strangers and withheld callers", () => {
    expect(inboundCallerRefusal(env(), STRANGER)).not.toBeNull();
    expect(inboundCallerRefusal(env(), null)).not.toBeNull();
    expect(inboundCallerRefusal(env(), "anonymous")).not.toBeNull();
  });
});

describe("the rig's Stripe and webhook refusals", () => {
  const env = () => getEnv(rigEnv());

  it("accepts only sandbox events", () => {
    expect(liveStripeEventRefusal(env(), { livemode: false })).toBeNull();
    expect(liveStripeEventRefusal(env(), { livemode: true })).not.toBeNull();
    expect(liveStripeEventRefusal(env(), {})).not.toBeNull();
  });

  it("delivers customer webhooks to the robot only", () => {
    expect(customerWebhookRefusal(env(), "https://robot.rig.internal/hooks/1")).toBeNull();
    expect(customerWebhookRefusal(env(), "https://hooks.example.com/x")).not.toBeNull();
    expect(customerWebhookRefusal(env(), "not a url")).not.toBeNull();
    const bindings: Record<string, unknown> = { ...rigEnv() };
    delete bindings.RIG_ROBOT_WEBHOOK_ORIGIN;
    expect(
      customerWebhookRefusal(getEnv(bindings), "https://robot.rig.internal/hooks/1"),
    ).not.toBeNull();
  });
});

describe("the rig's FCM credential", () => {
  it("is the guard caller token, so nothing on the rig mints a Google token", () => {
    expect(fcmCredential(getEnv(rigEnv()))).toEqual({
      kind: "guard",
      bearer: "rig-caller-token-0123456789",
    });
  });
});

describe("the rig's messaging-profile limits", () => {
  const env = () => getEnv(rigEnv());
  const create = { method: "POST", path: "/v2/messaging_profiles" };

  it("caps the daily spend and keeps US and Canada only", () => {
    expect(
      restrictTelnyxBody(env(), create, {
        name: "c",
        whitelisted_destinations: ["US", "CA", "GB"],
      }),
    ).toEqual({
      name: "c",
      whitelisted_destinations: ["US", "CA"],
      daily_spend_limit: RIG_MESSAGING_PROFILE_DAILY_LIMIT,
      daily_spend_limit_enabled: true,
    });
  });

  it("only narrows: a smaller whitelist and a lower limit survive", () => {
    expect(
      restrictTelnyxBody(env(), { method: "PATCH", path: "/v2/messaging_profiles/mp-1" }, {
        whitelisted_destinations: ["CA"],
        daily_spend_limit: "0.01",
      }),
    ).toEqual({
      whitelisted_destinations: ["CA"],
      daily_spend_limit: "0.01",
      daily_spend_limit_enabled: true,
    });
    expect(
      restrictTelnyxBody(env(), create, { daily_spend_limit: "250.00" }),
    ).toMatchObject({ daily_spend_limit: RIG_MESSAGING_PROFILE_DAILY_LIMIT });
  });

  it.each([
    ["null", null],
    ["an empty string", ""],
    ["blank", "  "],
    ["false", false],
    ["zero", "0"],
    ["a negative amount", -1],
    ["not a number", "lots"],
    ["an array", []],
  ])("caps a limit that is %s rather than keeping it", (_label, asked) => {
    expect(restrictTelnyxBody(env(), create, { daily_spend_limit: asked })).toMatchObject({
      daily_spend_limit: RIG_MESSAGING_PROFILE_DAILY_LIMIT,
      daily_spend_limit_enabled: true,
    });
  });

  it("keeps a lower limit given as a number", () => {
    expect(restrictTelnyxBody(env(), create, { daily_spend_limit: 0.02 })).toMatchObject({
      daily_spend_limit: 0.02,
    });
  });

  it("leaves every other request alone", () => {
    const body = { to: OWNED_A };
    expect(restrictTelnyxBody(env(), { method: "POST", path: "/v2/messages" }, body)).toBe(body);
    expect(
      restrictTelnyxBody(env(), { method: "GET", path: "/v2/messaging_profiles" }, undefined),
    ).toBeUndefined();
  });
});

describe("Sentry's environment comes from DEPLOY_ENV", () => {
  it("names each deployment", () => {
    expect(sentryOptions({ ...completeEnv(), DEPLOY_ENV: "production" }).environment).toBe(
      "production",
    );
    expect(sentryOptions(rigEnv()).environment).toBe("rig");
    expect(sentryOptions(completeEnv()).environment).toBe("development");
  });

  it("does not take a release stamp to mean production", () => {
    expect(sentryOptions({ ...completeEnv(), GIT_SHA: "abc123" }).environment).toBe(
      "development",
    );
  });
});
