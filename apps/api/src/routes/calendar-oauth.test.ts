import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sealCalendarCredential } from "../calendar/crypto";
import type { AppEnv } from "../context";
import type { Env } from "../env";
import { hashToken } from "../public-links/tokens";
import { supabaseStub } from "../test/routes-harness";
import {
  completeEnv,
  stubFetch,
  type FetchRoute,
} from "../test/support";
import { calendarPublicRoutes } from "./calendar-oauth";

const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const USER_ID = "6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01";
const CONNECTION_ID = "cccccccc-1111-4222-8333-444444444444";
const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const STATE = "S".repeat(43);
const VERIFIER = "V".repeat(43);
const ACCESS_TOKEN = "access-token-must-not-be-persisted";
const REFRESH_TOKEN = "refresh-token-must-be-encrypted";

function configuredEnv(): Env {
  return {
    ...completeEnv(),
    GOOGLE_CALENDAR_CLIENT_ID: "google-client",
    GOOGLE_CALENDAR_CLIENT_SECRET: "google-secret",
    MICROSOFT_CALENDAR_CLIENT_ID: "microsoft-client",
    MICROSOFT_CALENDAR_CLIENT_SECRET: "microsoft-secret",
    MICROSOFT_CALENDAR_TENANT: "common",
    CALENDAR_TOKEN_ENCRYPTION_KEYS: JSON.stringify({ v1: KEY }),
    CALENDAR_TOKEN_ENCRYPTION_ACTIVE_KEY: "v1",
  };
}

const app = new Hono<AppEnv>();
app.route("/", calendarPublicRoutes);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function oauthState(provider: "google" | "microsoft") {
  const sealed = await sealCalendarCredential(
    VERIFIER,
    {
      companyId: COMPANY_ID,
      userId: USER_ID,
      provider,
      purpose: "oauth_pkce_verifier",
    },
    { activeVersion: "v1", keys: { v1: KEY } },
  );
  return {
    company_id: COMPANY_ID,
    user_id: USER_ID,
    provider,
    verifier_ciphertext: sealed.ciphertext,
    verifier_iv: sealed.iv,
    verifier_key_version: sealed.keyVersion,
    redirect_uri: `https://api.loonext.com/calendar/oauth/${provider}/callback`,
  };
}

async function callback(
  env: Env,
  provider: "google" | "microsoft",
  query = `state=${STATE}&code=provider-code`,
) {
  return app.fetch(
    new Request(
      `https://api.loonext.com/calendar/oauth/${provider}/callback?${query}`,
    ),
    env,
  );
}

describe("calendar OAuth callback", () => {
  it("consumes state once, encrypts the refresh token, and installs a hashed watch", async () => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    const state = await oauthState("google");
    let consumeCount = 0;
    sb.on("POST", "/rest/v1/rpc/api_consume_calendar_oauth_state", () => {
      consumeCount += 1;
      return consumeCount === 1
        ? { outcome: "consumed", state }
        : { outcome: "invalid" };
    });
    sb.on("GET", "/rest/v1/companies", () => [{ timezone: "America/Edmonton" }]);
    let tokenCalls = 0;
    let watchBody: Record<string, unknown> | null = null;
    sb.on("POST", "/rest/v1/rpc/api_complete_calendar_connection", () => {
      expect(watchBody).not.toBeNull();
      return {
        outcome: "connected",
        connection_id: CONNECTION_ID,
        webhook_subscription_id: "watch-row",
        ics_revoked: 1,
        creates_queued: 3,
      };
    });
    const providerRoute: FetchRoute = async (url, request) => {
      if (url.href === "https://oauth2.googleapis.com/token") {
        tokenCalls += 1;
        const body = new URLSearchParams(await request.clone().text());
        expect(body.get("code_verifier")).toBe(VERIFIER);
        expect(body.get("code")).toBe("provider-code");
        return Response.json({
          access_token: ACCESS_TOKEN,
          refresh_token: REFRESH_TOKEN,
          expires_in: 3600,
        });
      }
      if (
        url.href ===
        "https://www.googleapis.com/calendar/v3/calendars/primary"
      ) {
        expect(request.headers.get("Authorization")).toBe(`Bearer ${ACCESS_TOKEN}`);
        return Response.json({
          id: "dana@example.com",
          summary: "Dana's jobs",
          timeZone: "America/Toronto",
        });
      }
      if (
        url.href ===
        "https://www.googleapis.com/calendar/v3/calendars/primary/events/watch"
      ) {
        watchBody = (await request.clone().json()) as Record<string, unknown>;
        expect(watchBody.address).toBe(
          "https://api.loonext.com/calendar/webhooks/google",
        );
        return Response.json({
          id: watchBody.id,
          resourceId: "google-resource",
          expiration: String(Date.now() + 86_400_000),
        });
      }
      return undefined;
    };
    stubFetch(providerRoute, sb.route);

    const first = await callback(env, "google");
    expect(first.status).toBe(303);
    expect(first.headers.get("location")).toBe(
      "https://app.loonext.com/settings/profile?calendar=connected",
    );
    expect(watchBody).not.toBeNull();

    const complete = sb.find(
      "POST",
      "/rest/v1/rpc/api_complete_calendar_connection",
    )[0].body as Record<string, unknown>;
    expect(complete.p_selected_calendar_id).toBe("primary");
    expect(complete.p_selected_calendar_timezone).toBe("America/Toronto");
    expect(complete.p_credential_ciphertext).not.toBe(REFRESH_TOKEN);
    expect(JSON.stringify(complete)).not.toContain(REFRESH_TOKEN);
    expect(JSON.stringify(complete)).not.toContain(ACCESS_TOKEN);

    const clientState = watchBody!.token as string;
    expect(clientState).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(complete.p_client_state_hash).toBe(await hashToken(clientState));
    expect(complete.p_provider_subscription_id).toBe(watchBody!.id);
    expect(complete.p_provider_resource_id).toBe("google-resource");
    expect(JSON.stringify(complete)).not.toContain(clientState);
    expect(
      sb.find(
        "POST",
        "/rest/v1/rpc/api_install_calendar_webhook_subscription",
      ),
    ).toHaveLength(0);

    const replay = await callback(env, "google");
    expect(replay.status).toBe(303);
    expect(replay.headers.get("location")).toBe(
      "https://app.loonext.com/settings/profile?calendar=failed",
    );
    expect(tokenCalls).toBe(1);
    expect(consumeCount).toBe(2);
  });

  it("burns a state delivered on the wrong provider path before rejecting it", async () => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_consume_calendar_oauth_state", () => ({
      outcome: "consumed",
      state: awaitableState,
    }));
    const awaitableState = await oauthState("google");
    // The responder closes over the settled object; no provider route is
    // registered, so any attempted code exchange fails this test loudly.
    stubFetch(sb.route);

    const response = await callback(env, "microsoft");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://app.loonext.com/settings/profile?calendar=failed",
    );
    expect(sb.find("POST", "/rest/v1/rpc/api_consume_calendar_oauth_state")).toHaveLength(1);
    expect(sb.find("POST", "/rest/v1/rpc/api_complete_calendar_connection")).toHaveLength(0);
  });

  it("rejects a token response with no refresh token", async () => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_consume_calendar_oauth_state", () => ({
      outcome: "consumed",
      state: stateRow,
    }));
    const stateRow = await oauthState("google");
    const providerRoute: FetchRoute = (url) =>
      url.href === "https://oauth2.googleapis.com/token"
        ? Response.json({ access_token: ACCESS_TOKEN, expires_in: 3600 })
        : undefined;
    stubFetch(providerRoute, sb.route);

    const response = await callback(env, "google");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://app.loonext.com/settings/profile?calendar=failed",
    );
    expect(sb.find("GET", "/rest/v1/companies")).toHaveLength(0);
    expect(sb.find("POST", "/rest/v1/rpc/api_complete_calendar_connection")).toHaveLength(0);
  });

  it("uses Graph's default calendar and the company timezone for Microsoft", async () => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    const stateRow = await oauthState("microsoft");
    sb.on("POST", "/rest/v1/rpc/api_consume_calendar_oauth_state", () => ({
      outcome: "consumed",
      state: stateRow,
    }));
    sb.on("GET", "/rest/v1/companies", () => [{ timezone: "America/Edmonton" }]);
    sb.on("POST", "/rest/v1/rpc/api_complete_calendar_connection", () => ({
      outcome: "connected",
      connection_id: CONNECTION_ID,
    }));
    let subscriptionBody: Record<string, unknown> | null = null;
    const providerRoute: FetchRoute = async (url, request) => {
      if (
        url.href ===
        "https://login.microsoftonline.com/common/oauth2/v2.0/token"
      ) {
        const body = new URLSearchParams(await request.clone().text());
        expect(body.get("code_verifier")).toBe(VERIFIER);
        return Response.json({
          access_token: ACCESS_TOKEN,
          refresh_token: REFRESH_TOKEN,
          expires_in: 3600,
        });
      }
      if (
        url.href ===
        "https://graph.microsoft.com/v1.0/me/calendar?$select=id,name,owner"
      ) {
        return Response.json({
          id: "calendar-id",
          name: "Field schedule",
          owner: { name: "Dana", address: "dana@example.com" },
        });
      }
      if (url.href === "https://graph.microsoft.com/v1.0/subscriptions") {
        subscriptionBody = (await request.clone().json()) as Record<string, unknown>;
        return Response.json({
          id: "graph-subscription",
          resource: "/me/events",
          expirationDateTime: subscriptionBody.expirationDateTime,
        });
      }
      return undefined;
    };
    stubFetch(providerRoute, sb.route);

    const response = await callback(env, "microsoft");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://app.loonext.com/settings/profile?calendar=connected",
    );
    expect(subscriptionBody).toMatchObject({
      changeType: "created,updated,deleted",
      notificationUrl: "https://api.loonext.com/calendar/webhooks/microsoft",
      resource: "/me/events",
    });
    const complete = sb.find(
      "POST",
      "/rest/v1/rpc/api_complete_calendar_connection",
    )[0].body as Record<string, unknown>;
    expect(complete).toMatchObject({
      p_provider: "microsoft",
      p_provider_account_id: "dana@example.com",
      p_provider_account_label: "Dana",
      p_selected_calendar_id: "calendar-id",
      p_selected_calendar_name: "Field schedule",
      p_selected_calendar_timezone: "America/Edmonton",
      p_provider_subscription_id: "graph-subscription",
      p_provider_resource_id: "/me/events",
    });
    const clientState = subscriptionBody!.clientState as string;
    expect(complete.p_client_state_hash).toBe(await hashToken(clientState));
    expect(JSON.stringify(complete)).not.toContain(clientState);
  });

  it.each([
    "replacement_requires_disconnect",
    "disconnect_in_progress",
  ] as const)(
    "returns a safe %s result and stops the rejected provisional watch",
    async (outcome) => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    const stateRow = await oauthState("google");
    let watchStarted = false;
    sb.on("POST", "/rest/v1/rpc/api_consume_calendar_oauth_state", () => ({
      outcome: "consumed",
      state: stateRow,
    }));
    sb.on("GET", "/rest/v1/companies", () => [{ timezone: "America/Edmonton" }]);
    sb.on("POST", "/rest/v1/rpc/api_complete_calendar_connection", () => {
      expect(watchStarted).toBe(true);
      return {
        outcome,
        provider_account_id: "must-not-leak@example.com",
        selected_calendar_id: "must-not-leak-calendar",
      };
    });
    let stopBody: Record<string, unknown> | null = null;
    const providerRoute: FetchRoute = async (url, request) => {
      if (url.href === "https://oauth2.googleapis.com/token") {
        return Response.json({
          access_token: ACCESS_TOKEN,
          refresh_token: REFRESH_TOKEN,
          expires_in: 3600,
        });
      }
      if (
        url.href ===
        "https://www.googleapis.com/calendar/v3/calendars/primary"
      ) {
        return Response.json({
          id: "dana@example.com",
          summary: "Dana's jobs",
          timeZone: "America/Edmonton",
        });
      }
      if (
        url.href ===
        "https://www.googleapis.com/calendar/v3/calendars/primary/events/watch"
      ) {
        watchStarted = true;
        const body = (await request.clone().json()) as Record<string, unknown>;
        return Response.json({
          id: body.id,
          resourceId: "provisional-resource",
          expiration: String(Date.now() + 86_400_000),
        });
      }
      if (url.href === "https://www.googleapis.com/calendar/v3/channels/stop") {
        stopBody = (await request.clone().json()) as Record<string, unknown>;
        return new Response(null, { status: 204 });
      }
      return undefined;
    };
    stubFetch(providerRoute, sb.route);

    const response = await callback(env, "google");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `https://app.loonext.com/settings/profile?calendar=${outcome}`,
    );
    expect(response.headers.get("location")).not.toContain("must-not-leak");
    expect(stopBody).toMatchObject({ resourceId: "provisional-resource" });
    expect(sb.find("PATCH", "/rest/v1/calendar_connections")).toHaveLength(0);
    expect(
      sb.find(
        "POST",
        "/rest/v1/rpc/api_install_calendar_webhook_subscription",
      ),
    ).toHaveLength(0);
    },
  );
});

async function postPublic(env: Env, path: string, init: RequestInit) {
  return app.fetch(new Request(`https://api.loonext.com${path}`, init), env);
}

describe("calendar provider webhooks", () => {
  it("echoes Graph's decoded validation token exactly", async () => {
    const env = configuredEnv();
    const response = await postPublic(
      env,
      "/calendar/webhooks/microsoft?validationToken=hello%2Bthere%2F%3D",
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello+there/=");
    expect(response.headers.get("content-type")).toContain("text/plain");
  });

  it("rejects Google header spoofing with the same response as an unknown watch", async () => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_request_calendar_pull", () => ({
      outcome: "ignored",
    }));
    stubFetch(sb.route);

    const malformed = await postPublic(env, "/calendar/webhooks/google", {
      method: "POST",
      headers: {
        "X-Goog-Channel-ID": "watch-1",
        "X-Goog-Resource-ID": "resource-1",
        "X-Goog-Channel-Token": "too-short",
        "X-Goog-Resource-State": "exists",
        "X-Goog-Message-Number": "1",
      },
    });
    expect(malformed.status).toBe(404);
    expect(await malformed.text()).toBe("Not found");
    expect(sb.find("POST", "/rest/v1/rpc/api_request_calendar_pull")).toHaveLength(0);

    const unknown = await postPublic(env, "/calendar/webhooks/google", {
      method: "POST",
      headers: {
        "X-Goog-Channel-ID": "watch-1",
        "X-Goog-Resource-ID": "resource-1",
        "X-Goog-Channel-Token": "T".repeat(43),
        "X-Goog-Resource-State": "exists",
        "X-Goog-Message-Number": "2",
      },
    });
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toBe("Not found");
  });

  it("hashes Google client state and coalesces duplicate notifications through the RPC", async () => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    let generation = 0;
    sb.on("POST", "/rest/v1/rpc/api_request_calendar_pull", () => ({
      outcome: "queued",
      connection_id: CONNECTION_ID,
      generation: ++generation,
    }));
    stubFetch(sb.route);
    const token = "T".repeat(43);
    const init: RequestInit = {
      method: "POST",
      headers: {
        "X-Goog-Channel-ID": "watch-1",
        "X-Goog-Resource-ID": "resource-1",
        "X-Goog-Channel-Token": token,
        "X-Goog-Resource-State": "exists",
        "X-Goog-Message-Number": "42",
      },
    };

    expect((await postPublic(env, "/calendar/webhooks/google", init)).status).toBe(204);
    expect((await postPublic(env, "/calendar/webhooks/google", init)).status).toBe(204);
    const calls = sb.find("POST", "/rest/v1/rpc/api_request_calendar_pull");
    expect(calls).toHaveLength(2);
    expect(calls[0].body).toEqual({
      p_provider: "google",
      p_subscription_id: "watch-1",
      p_resource_id: "resource-1",
      p_client_state_hash: await hashToken(token),
    });
    expect(JSON.stringify(calls)).not.toContain(token);
  });

  it("validates, hashes, and deduplicates Microsoft notification client state", async () => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_request_calendar_pull", () => ({
      outcome: "queued",
      connection_id: CONNECTION_ID,
      generation: 1,
    }));
    stubFetch(sb.route);
    const token = "M".repeat(43);

    const response = await postPublic(env, "/calendar/webhooks/microsoft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        value: [
          {
            subscriptionId: "graph-watch",
            clientState: token,
            resource: "Users/abc/Events/event-1",
          },
          {
            subscriptionId: "graph-watch",
            clientState: token,
            resource: "Users/abc/Events/event-1",
          },
        ],
      }),
    });
    expect(response.status).toBe(202);
    const calls = sb.find("POST", "/rest/v1/rpc/api_request_calendar_pull");
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.body).toEqual({
      p_provider: "microsoft",
      p_subscription_id: "graph-watch",
      p_resource_id: "Users/abc/Events/event-1",
      p_client_state_hash: await hashToken(token),
    });
    expect(JSON.stringify(call)).not.toContain(token);
  });

  it("rejects an oversized Microsoft webhook before calling the database", async () => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    stubFetch(sb.route);

    const response = await postPublic(env, "/calendar/webhooks/microsoft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Deliberately no Content-Length header: the streaming cap must protect
      // chunked requests too, not only well-behaved provider deliveries.
      body: JSON.stringify({ value: [], padding: "x".repeat(140 * 1024) }),
    });

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
    expect(sb.find("POST", "/rest/v1/rpc/api_request_calendar_pull")).toHaveLength(0);
  });

  it("bounds database fan-out for a large valid Microsoft batch", async () => {
    const env = configuredEnv();
    let active = 0;
    let maximumActive = 0;
    let calls = 0;
    const route: FetchRoute = async (url) => {
      if (url.pathname === "/rest/v1/rpc/api_request_calendar_pull") {
        active += 1;
        calls += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return Response.json({ outcome: "queued" });
      }
      return undefined;
    };
    stubFetch(route);
    const token = "B".repeat(43);

    const response = await postPublic(env, "/calendar/webhooks/microsoft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        value: Array.from({ length: 24 }, (_, index) => ({
          subscriptionId: `graph-watch-${index}`,
          clientState: token,
        })),
      }),
    });

    expect(response.status).toBe(202);
    expect(calls).toBe(24);
    expect(maximumActive).toBeLessThanOrEqual(8);
    expect(maximumActive).toBeGreaterThan(1);
  });
});
