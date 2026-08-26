import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  apiRequest,
  buildTestApp,
  membershipResponder,
  supabaseStub,
} from "../test/routes-harness";
import {
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type TestAuth,
} from "../test/support";
import type { Env } from "../env";
import { hashToken } from "../public-links/tokens";
import { sealCalendarCredential } from "../calendar/crypto";
import { calendarConnectionRoutes } from "./calendar-connections";

const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const CONNECTION_ID = "cccccccc-1111-4222-8333-444444444444";
const LINK_ID = "dddddddd-1111-4222-8333-444444444444";
const TASK_ID = "eeeeeeee-1111-4222-8333-444444444444";
const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function configuredEnv(): Env {
  return {
    ...completeEnv(),
    GOOGLE_CALENDAR_CLIENT_ID: "google-client",
    GOOGLE_CALENDAR_CLIENT_SECRET: "google-secret",
    MICROSOFT_CALENDAR_CLIENT_ID: "microsoft-client",
    MICROSOFT_CALENDAR_CLIENT_SECRET: "microsoft-secret",
    CALENDAR_TOKEN_ENCRYPTION_KEYS: JSON.stringify({ v1: KEY }),
    CALENDAR_TOKEN_ENCRYPTION_ACTIVE_KEY: "v1",
  };
}

const app = buildTestApp(calendarConnectionRoutes);
let auth: TestAuth;

function attentionRow(
  state: "conflict" | "event_removed" | "refused" = "conflict",
) {
  return {
    link_id: LINK_ID,
    task_id: TASK_ID,
    connection_id: CONNECTION_ID,
    provider: "google",
    provider_calendar_id: "primary",
    provider_calendar_name: "Field schedule",
    provider_calendar_timezone: "America/Edmonton",
    provider_instance_id: "provider-event-1",
    provider_version: '"etag-observed"',
    link_state: state,
    provider_condition: state,
    task_title: "Furnace tune-up",
    task_due_at:
      state === "event_removed" ? null : "2026-11-03T16:00:00.000Z",
    ours_snapshot: {
      start: "2026-11-03T16:00:00.000Z",
      end: "2026-11-03T17:00:00.000Z",
      timeZone: "America/Edmonton",
      title: "Furnace tune-up",
      descriptionHash: "a".repeat(64),
    },
    theirs_snapshot: state === "conflict"
      ? {
          start: "2026-11-03T18:00:00.000Z",
          end: "2026-11-03T19:00:00.000Z",
          timeZone: "America/Edmonton",
          title: "Furnace tune-up moved",
          descriptionHash: "b".repeat(64),
        }
      : null,
    ours_changed_at: "2026-11-03T14:00:00.000Z",
    ours_changed_by: MEMBER_ID,
    ours_changed_by_name: "Dana",
    provider_observed_at: "2026-11-03T14:05:00.000Z",
    attention_at: "2026-11-03T14:05:01.000Z",
    refusal_code: state === "refused" ? "all_day" : null,
    refusal_detail: state === "refused" ? "Provider event is all-day" : null,
  };
}

beforeAll(async () => {
  auth = await createTestAuth(completeEnv());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("calendar connection management", () => {
  it("lists only the caller's live connection in the UI contract", async () => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("GET", "/rest/v1/calendar_connections", () => [
      {
        id: CONNECTION_ID,
        provider: "google",
        status: "active",
        provider_account_id: "dana@example.com",
        provider_account_label: null,
        selected_calendar_id: "primary",
        selected_calendar_name: "Jobs",
        last_verified_at: "2026-08-25T10:00:00Z",
        last_sync_completed_at: "2026-08-25T10:01:00Z",
        last_error_code: null,
      },
    ]);
    sb.on("GET", "/rest/v1/task_calendar_links", () => [
      { connection_id: CONNECTION_ID },
      { connection_id: CONNECTION_ID },
    ]);
    sb.on("POST", "/rest/v1/rpc/api_list_calendar_owner_disclosures", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/calendar/connections",
      { companyId: COMPANY_ID },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      connections: [
        {
          id: CONNECTION_ID,
          provider: "google",
          status: "active",
          account_label: "dana@example.com",
          calendar_label: "Jobs",
          last_verified_at: "2026-08-25T10:00:00Z",
          last_sync_at: "2026-08-25T10:01:00Z",
          last_error_key: null,
          conflict_count: 2,
        },
      ],
      disclosures: [],
      configured: { google: true, microsoft: true },
    });

    const read = sb.find("GET", "/rest/v1/calendar_connections")[0];
    expect(read.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(read.url.searchParams.get("user_id")).toBe(`eq.${auth.subject}`);
    expect(read.url.searchParams.get("revoked_at")).toBe("is.null");
  });

  it("surfaces a content-free cleanup warning returned for the workspace owner", async () => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "owner"),
    );
    sb.on("GET", "/rest/v1/calendar_connections", () => []);
    sb.on("POST", "/rest/v1/rpc/api_list_calendar_owner_disclosures", () => [
      {
        connection_id: CONNECTION_ID,
        provider: "google",
        reason: "cleanup_failed",
        occurred_at: "2026-08-25T12:00:00.000Z",
        push_delivered_at: null,
      },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/calendar/connections",
      { companyId: COMPANY_ID },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      connections: [],
      disclosures: [{
        connection_id: CONNECTION_ID,
        provider: "google",
        reason: "cleanup_failed",
        push_delivered_at: null,
      }],
    });
    expect(
      sb.find("POST", "/rest/v1/rpc/api_list_calendar_owner_disclosures")[0].body,
    ).toEqual({ p_company_id: COMPANY_ID, p_user_id: auth.subject });
  });

  it("returns 503 without minting state when the selected connector is disabled", async () => {
    const env = completeEnv();
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "member"),
    );
    stubFetch(jwksRoute(auth), sb.route);

    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/calendar/connections/google/authorize",
      { method: "POST", companyId: COMPANY_ID },
    );
    expect(response.status).toBe(503);
    const error = (await response.json()) as { error: { code: string } };
    expect(error.error.code).toBe("service_unavailable");
    expect(sb.find("POST", "/rest/v1/rpc/api_create_calendar_oauth_state")).toHaveLength(0);
  });

  it("does not let a read-only observer connect or disconnect a writable calendar", async () => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "read_only"),
    );
    stubFetch(jwksRoute(auth), sb.route);

    const authorize = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/calendar/connections/google/authorize",
      { method: "POST", companyId: COMPANY_ID },
    );
    const disconnect = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calendar/connections/${CONNECTION_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );

    expect(authorize.status).toBe(403);
    expect(disconnect.status).toBe(403);
    expect(
      sb.find("POST", "/rest/v1/rpc/api_create_calendar_oauth_state"),
    ).toHaveLength(0);
    expect(sb.find("GET", "/rest/v1/calendar_connections")).toHaveLength(0);
    expect(
      sb.find("POST", "/rest/v1/rpc/api_revoke_calendar_connection"),
    ).toHaveLength(0);
  });

  it("persists only a state hash and an AES-sealed PKCE verifier", async () => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("POST", "/rest/v1/rpc/api_create_calendar_oauth_state", () =>
      CONNECTION_ID
    );
    stubFetch(jwksRoute(auth), sb.route);

    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/calendar/connections/google/authorize",
      { method: "POST", companyId: COMPANY_ID },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { url: string };
    const authorization = new URL(body.url);
    const state = authorization.searchParams.get("state");
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("access_type")).toBe("offline");

    const write = sb.find(
      "POST",
      "/rest/v1/rpc/api_create_calendar_oauth_state",
    )[0].body as Record<string, string>;
    expect(write.p_state_hash).toBe(await hashToken(state!));
    expect(write.p_verifier_ciphertext).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(write.p_verifier_iv).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(write.p_verifier_key_version).toBe("v1");
    expect(JSON.stringify(write)).not.toContain(state!);
    expect(write).not.toHaveProperty("p_verifier");
  });

  it("cannot revoke another member's connection id", async () => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("GET", "/rest/v1/calendar_connections", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calendar/connections/${CONNECTION_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(response.status).toBe(404);
    expect(sb.find("POST", "/rest/v1/rpc/api_revoke_calendar_connection")).toHaveLength(0);
    const lookup = sb.find("GET", "/rest/v1/calendar_connections")[0];
    expect(lookup.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(lookup.url.searchParams.get("user_id")).toBe(`eq.${auth.subject}`);
    expect(lookup.url.searchParams.get("id")).toBe(`eq.${CONNECTION_ID}`);
  });

  it("revokes the caller's connection through the lifecycle RPC", async () => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("GET", "/rest/v1/calendar_connections", () => [{ id: CONNECTION_ID }]);
    sb.on("POST", "/rest/v1/rpc/api_revoke_calendar_connection", () => ({
      outcome: "revoked",
      count: 1,
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calendar/connections/${CONNECTION_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );
    expect(response.status).toBe(204);
    expect(
      sb.find("POST", "/rest/v1/rpc/api_revoke_calendar_connection")[0].body,
    ).toEqual({
      p_company_id: COMPANY_ID,
      p_user_id: auth.subject,
      p_connection_id: CONNECTION_ID,
    });
  });

  it("reports accepted while remote disconnect cleanup is still draining", async () => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("GET", "/rest/v1/calendar_connections", () => [{ id: CONNECTION_ID }]);
    sb.on("POST", "/rest/v1/rpc/api_revoke_calendar_connection", () => ({
      outcome: "disconnecting",
      count: 1,
      connection_id: CONNECTION_ID,
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calendar/connections/${CONNECTION_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );

    expect(response.status).toBe(202);
  });

  it.each([
    "ambiguous_provider_write",
    "webhook_renewal_in_flight",
  ])("refuses to report a completed disconnect while %s is recoverable", async (reason) => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("GET", "/rest/v1/calendar_connections", () => [{ id: CONNECTION_ID }]);
    sb.on("POST", "/rest/v1/rpc/api_revoke_calendar_connection", () => ({
      outcome: "busy",
      reason,
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calendar/connections/${CONNECTION_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "conflict" },
    });
  });

  it("refuses a stale disconnect that targets a superseded connection id", async () => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("GET", "/rest/v1/calendar_connections", () => [{ id: CONNECTION_ID }]);
    sb.on("POST", "/rest/v1/rpc/api_revoke_calendar_connection", () => ({
      outcome: "superseded",
      connection_id: "aaaaaaaa-1111-4222-8333-444444444444",
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calendar/connections/${CONNECTION_ID}`,
      { method: "DELETE", companyId: COMPANY_ID },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "conflict" },
    });
  });

  it("lists only the caller's attention details without exposing snapshot hashes", async () => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("POST", "/rest/v1/rpc/api_list_calendar_attention", () => [
      attentionRow(),
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      "/v1/calendar/attention?limit=25",
      { companyId: COMPANY_ID },
    );
    expect(response.status).toBe(200);
    const body = await response.json() as {
      attention: Array<Record<string, unknown>>;
    };
    expect(body.attention).toHaveLength(1);
    expect(body.attention[0]).toMatchObject({
      id: LINK_ID,
      state: "conflict",
      task: {
        id: TASK_ID,
        title: "Furnace tune-up",
        due_at: "2026-11-03T16:00:00.000Z",
      },
      connection: {
        id: CONNECTION_ID,
        provider: "google",
        calendar_label: "Field schedule",
      },
      ours: {
        start: "2026-11-03T16:00:00.000Z",
        time_zone: "America/Edmonton",
      },
      theirs: { start: "2026-11-03T18:00:00.000Z" },
      differences: {
        start: true,
        title: true,
        description: true,
      },
      display_timestamps: {
        ours_changed_at: "2026-11-03T14:00:00.000Z",
        provider_observed_at: "2026-11-03T14:05:00.000Z",
        attention_at: "2026-11-03T14:05:01.000Z",
      },
    });
    expect(JSON.stringify(body)).not.toContain("a".repeat(64));
    expect(JSON.stringify(body)).not.toContain("b".repeat(64));
    expect(JSON.stringify(body)).not.toContain("provider-event-1");

    expect(
      sb.find("POST", "/rest/v1/rpc/api_list_calendar_attention")[0].body,
    ).toEqual({
      p_company_id: COMPANY_ID,
      p_user_id: auth.subject,
      p_limit: 25,
    });
  });

  it("does not reveal another member's attention item", async () => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("POST", "/rest/v1/rpc/api_get_calendar_attention", () => ({
      outcome: "not_found",
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calendar/attention/${LINK_ID}/resolve`,
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: { action: "use_app" },
      },
    );
    expect(response.status).toBe(404);
    expect(
      sb.find("POST", "/rest/v1/rpc/api_get_calendar_attention")[0].body,
    ).toEqual({
      p_company_id: COMPANY_ID,
      p_user_id: auth.subject,
      p_link_id: LINK_ID,
    });
    expect(
      sb.find("POST", "/rest/v1/rpc/api_resolve_calendar_conflict"),
    ).toHaveLength(0);
  });

  it("denies attention resolution without task-write capability", async () => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "read_only"),
    );
    stubFetch(jwksRoute(auth), sb.route);

    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calendar/attention/${LINK_ID}/resolve`,
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: { action: "use_app" },
      },
    );
    expect(response.status).toBe(403);
    expect(
      sb.find("POST", "/rest/v1/rpc/api_get_calendar_attention"),
    ).toHaveLength(0);
  });

  it("queues the app copy after the provider side of a conflict becomes refused", async () => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("POST", "/rest/v1/rpc/api_get_calendar_attention", () => ({
      outcome: "found",
      attention: {
        ...attentionRow(),
        provider_condition: "refused",
        refusal_code: "all_day",
        refusal_detail: "Provider event is all-day",
      },
    }));
    sb.on("POST", "/rest/v1/rpc/api_resolve_calendar_conflict", () => ({
      outcome: "queued",
      outbox_id: "ffffffff-1111-4222-8333-444444444444",
      generation: 2,
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calendar/attention/${LINK_ID}/resolve`,
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: { action: "use_app" },
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "queued" });
    expect(
      sb.find("POST", "/rest/v1/rpc/api_resolve_calendar_conflict")[0].body,
    ).toEqual({
      p_company_id: COMPANY_ID,
      p_user_id: auth.subject,
      p_link_id: LINK_ID,
      p_resolution: "use_app",
      p_expected_app_snapshot: attentionRow().ours_snapshot,
    });
    expect(sb.find("GET", "/rest/v1/calendar_connections")).toHaveLength(0);
  });

  it.each([
    ["disconnected", 409],
    ["task_ineligible", 409],
    ["provider_instance_mismatch", 409],
    ["app_snapshot_required", 409],
    ["attention_stale", 409],
    ["outside_sync_window", 409],
    ["provider_condition_changed", 409],
    ["not_found", 404],
    ["unexpected_future_outcome", 409],
  ])(
    "returns a non-success response when conflict resolution reports %s",
    async (outcome, expectedStatus) => {
      const env = configuredEnv();
      const sb = supabaseStub(env);
      sb.on(
        "POST",
        "/rest/v1/rpc/api_authorize_request",
        membershipResponder(MEMBER_ID, "member"),
      );
      sb.on("POST", "/rest/v1/rpc/api_get_calendar_attention", () => ({
        outcome: "found",
        attention: attentionRow(),
      }));
      sb.on("POST", "/rest/v1/rpc/api_resolve_calendar_conflict", () => ({
        outcome,
      }));
      stubFetch(jwksRoute(auth), sb.route);

      const response = await apiRequest(
        app,
        env,
        await auth.token(),
        `/v1/calendar/attention/${LINK_ID}/resolve`,
        {
          method: "POST",
          companyId: COMPANY_ID,
          body: { action: "use_app" },
        },
      );

      expect(response.status).toBe(expectedStatus);
      expect(await response.json()).toHaveProperty("error.code");
    },
  );

  it.each(["event_removed", "refused"] as const)(
    "does not offer stale calendar truth when a conflict provider condition became %s",
    async (providerCondition) => {
      const env = configuredEnv();
      const sb = supabaseStub(env);
      sb.on(
        "POST",
        "/rest/v1/rpc/api_authorize_request",
        membershipResponder(MEMBER_ID, "member"),
      );
      sb.on("POST", "/rest/v1/rpc/api_get_calendar_attention", () => ({
        outcome: "found",
        attention: {
          ...attentionRow(),
          provider_condition: providerCondition,
          refusal_code: providerCondition === "refused" ? "all_day" : null,
          refusal_detail:
            providerCondition === "refused" ? "Provider event is all-day" : null,
        },
      }));
      stubFetch(jwksRoute(auth), sb.route);

      const response = await apiRequest(
        app,
        env,
        await auth.token(),
        `/v1/calendar/attention/${LINK_ID}/resolve`,
        {
          method: "POST",
          companyId: COMPANY_ID,
          body: { action: "use_calendar" },
        },
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: { code: "conflict", message: expect.stringMatching(/app version/i) },
      });
      expect(sb.find("GET", "/rest/v1/calendar_connections")).toHaveLength(0);
      expect(
        sb.find("POST", "/rest/v1/rpc/api_resolve_calendar_conflict"),
      ).toHaveLength(0);
    },
  );

  it("re-reads the provider before resolving a conflict with use_calendar", async () => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    const sealed = await sealCalendarCredential(
      "stored-refresh-token",
      {
        companyId: COMPANY_ID,
        userId: auth.subject,
        provider: "google",
        purpose: "refresh_token",
      },
      { activeVersion: "v1", keys: { v1: KEY } },
    );
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("POST", "/rest/v1/rpc/api_get_calendar_attention", () => ({
      outcome: "found",
      attention: attentionRow(),
    }));
    sb.on("GET", "/rest/v1/calendar_connections", () => [
      {
        id: CONNECTION_ID,
        provider: "google",
        provider_account_id: "dana@example.com",
        selected_calendar_id: "primary",
        selected_calendar_timezone: "America/Edmonton",
        credential_generation: 7,
      },
    ]);
    sb.on("POST", "/rest/v1/rpc/api_claim_calendar_credential_refresh", () => ({
      outcome: "claimed",
      credential_generation: 7,
      credential_ciphertext: sealed.ciphertext,
      credential_iv: sealed.iv,
      credential_key_version: sealed.keyVersion,
    }));
    sb.on("POST", "/rest/v1/rpc/api_commit_calendar_credential_refresh", () => ({
      outcome: "committed",
      credential_generation: 8,
    }));
    sb.on("POST", "/rest/v1/rpc/api_resolve_calendar_conflict", () => ({
      outcome: "resolved",
      source: "calendar",
    }));
    const providerRoute = async (url: URL, request: Request) => {
      if (url.href === "https://oauth2.googleapis.com/token") {
        const form = new URLSearchParams(await request.clone().text());
        expect(form.get("refresh_token")).toBe("stored-refresh-token");
        return Response.json({
          access_token: "fresh-access-token",
          expires_in: 3600,
        });
      }
      if (
        url.href ===
        "https://www.googleapis.com/calendar/v3/calendars/primary/events/provider-event-1"
      ) {
        expect(request.headers.get("Authorization")).toBe(
          "Bearer fresh-access-token",
        );
        return Response.json({
          id: "provider-event-1",
          etag: '"etag-fresh"',
          summary: "Calendar truth",
          description: "Gate code 4417",
          start: {
            dateTime: "2026-11-03T11:00:00-07:00",
            timeZone: "America/Edmonton",
          },
          end: {
            dateTime: "2026-11-03T12:30:00-07:00",
            timeZone: "America/Edmonton",
          },
          organizer: { email: "dana@example.com", self: true },
        });
      }
      return undefined;
    };
    stubFetch(jwksRoute(auth), providerRoute, sb.route);

    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calendar/attention/${LINK_ID}/resolve`,
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: { action: "use_calendar" },
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      outcome: "resolved",
      source: "calendar",
    });
    const resolution = sb.find(
      "POST",
      "/rest/v1/rpc/api_resolve_calendar_conflict",
    )[0].body as Record<string, unknown>;
    expect(resolution).toMatchObject({
      p_company_id: COMPANY_ID,
      p_user_id: auth.subject,
      p_link_id: LINK_ID,
      p_resolution: "use_calendar",
      p_provider_instance_id: "provider-event-1",
      p_provider_version: '"etag-fresh"',
      p_start_at: "2026-11-03T18:00:00.000Z",
      p_end_at: "2026-11-03T19:30:00.000Z",
      p_time_zone: "America/Edmonton",
      p_title: "Calendar truth",
      p_description: "Gate code 4417",
      p_expected_app_snapshot: attentionRow().ours_snapshot,
    });
    const claim = sb.find(
      "POST",
      "/rest/v1/rpc/api_claim_calendar_credential_refresh",
    )[0].body as Record<string, unknown>;
    expect(claim).toMatchObject({
      p_company_id: COMPANY_ID,
      p_connection_id: CONNECTION_ID,
      p_user_id: auth.subject,
      p_expected_generation: 7,
      p_lease_seconds: 120,
    });
    const commit = sb.find(
      "POST",
      "/rest/v1/rpc/api_commit_calendar_credential_refresh",
    )[0].body as Record<string, unknown>;
    expect(commit).toMatchObject({
      p_connection_id: CONNECTION_ID,
      p_expected_generation: 7,
      p_credential_key_version: "v1",
    });
    expect(commit.p_worker_id).toBe(claim.p_worker_id);
    expect(sb.find("PATCH", "/rest/v1/calendar_connections")).toHaveLength(0);
  });

  it.each([
    ["a missing event", "removed"],
    ["an all-day event", "all_day"],
    ["an overlong description", "description_too_long"],
  ])(
    "durably records %s observed during use_calendar before asking for refresh",
    async (_label, condition) => {
      const env = configuredEnv();
      const sb = supabaseStub(env);
      const sealed = await sealCalendarCredential(
        "stored-refresh-token",
        {
          companyId: COMPANY_ID,
          userId: auth.subject,
          provider: "google",
          purpose: "refresh_token",
        },
        { activeVersion: "v1", keys: { v1: KEY } },
      );
      const attention = attentionRow();
      sb.on(
        "POST",
        "/rest/v1/rpc/api_authorize_request",
        membershipResponder(MEMBER_ID, "member"),
      );
      sb.on("POST", "/rest/v1/rpc/api_get_calendar_attention", () => ({
        outcome: "found",
        attention,
      }));
      sb.on("GET", "/rest/v1/calendar_connections", () => [{
        id: CONNECTION_ID,
        provider: "google",
        provider_account_id: "dana@example.com",
        selected_calendar_id: "primary",
        selected_calendar_timezone: "America/Edmonton",
        credential_generation: 7,
      }]);
      sb.on("POST", "/rest/v1/rpc/api_claim_calendar_credential_refresh", () => ({
        outcome: "claimed",
        credential_generation: 7,
        credential_ciphertext: sealed.ciphertext,
        credential_iv: sealed.iv,
        credential_key_version: sealed.keyVersion,
      }));
      sb.on("POST", "/rest/v1/rpc/api_commit_calendar_credential_refresh", () => ({
        outcome: "committed",
        credential_generation: 8,
      }));
      sb.on("POST", "/rest/v1/rpc/api_observe_calendar_conflict_condition", () => ({
        outcome: "observed",
        provider_condition: condition === "removed" ? "event_removed" : "refused",
      }));
      const providerRoute = async (url: URL) => {
        if (url.href === "https://oauth2.googleapis.com/token") {
          return Response.json({ access_token: "fresh", expires_in: 3600 });
        }
        if (url.hostname !== "www.googleapis.com") return undefined;
        if (condition === "removed") return Response.json({}, { status: 404 });
        return Response.json({
          id: "provider-event-1",
          etag: '"etag-new"',
          summary: "Calendar truth",
          description:
            condition === "description_too_long" ? "x".repeat(5_001) : "Notes",
          start:
            condition === "all_day"
              ? { date: "2026-11-03" }
              : {
                  dateTime: "2026-11-03T11:00:00-07:00",
                  timeZone: "America/Edmonton",
                },
          end:
            condition === "all_day"
              ? { date: "2026-11-04" }
              : {
                  dateTime: "2026-11-03T12:00:00-07:00",
                  timeZone: "America/Edmonton",
                },
          organizer: { email: "dana@example.com", self: true },
        });
      };
      stubFetch(jwksRoute(auth), providerRoute, sb.route);

      const response = await apiRequest(
        app,
        env,
        await auth.token(),
        `/v1/calendar/attention/${LINK_ID}/resolve`,
        {
          method: "POST",
          companyId: COMPANY_ID,
          body: { action: "use_calendar" },
        },
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: {
          code: "conflict",
          message: expect.stringMatching(/refresh/i),
        },
      });
      const observation = sb.find(
        "POST",
        "/rest/v1/rpc/api_observe_calendar_conflict_condition",
      )[0].body as Record<string, unknown>;
      expect(observation).toMatchObject({
        p_company_id: COMPANY_ID,
        p_user_id: auth.subject,
        p_link_id: LINK_ID,
        p_expected_provider_instance_id: "provider-event-1",
        p_expected_app_snapshot: attention.ours_snapshot,
        p_expected_provider_version: attention.provider_version,
        p_provider_condition:
          condition === "removed" ? "event_removed" : "refused",
      });
      if (condition === "all_day") {
        expect(observation).toMatchObject({
          p_observed_provider_version: '"etag-new"',
          p_refusal_code: "all_day",
        });
      }
      if (condition === "description_too_long") {
        expect(observation).toMatchObject({
          p_refusal_code: "description_too_long",
          p_refusal_detail: "too_long",
        });
      }
      expect(
        sb.find("POST", "/rest/v1/rpc/api_resolve_calendar_conflict"),
      ).toHaveLength(0);
    },
  );

  it("returns a retryable conflict when another worker owns the credential refresh", async () => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("POST", "/rest/v1/rpc/api_get_calendar_attention", () => ({
      outcome: "found",
      attention: attentionRow(),
    }));
    sb.on("GET", "/rest/v1/calendar_connections", () => [{
      id: CONNECTION_ID,
      provider: "google",
      provider_account_id: "dana@example.com",
      selected_calendar_id: "primary",
      selected_calendar_timezone: "America/Edmonton",
      credential_generation: 9,
    }]);
    sb.on("POST", "/rest/v1/rpc/api_claim_calendar_credential_refresh", () => ({
      outcome: "busy",
      credential_generation: 9,
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calendar/attention/${LINK_ID}/resolve`,
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: { action: "use_calendar" },
      },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "conflict", message: expect.stringMatching(/refreshing/i) },
    });
    expect(
      sb.find("POST", "/rest/v1/rpc/api_commit_calendar_credential_refresh"),
    ).toHaveLength(0);
    expect(
      sb.find("POST", "/rest/v1/rpc/api_resolve_calendar_conflict"),
    ).toHaveLength(0);
  });

  it("does not use an access token when OAuth reconnect supersedes its refresh commit", async () => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    const sealed = await sealCalendarCredential(
      "stored-refresh-token",
      {
        companyId: COMPANY_ID,
        userId: auth.subject,
        provider: "google",
        purpose: "refresh_token",
      },
      { activeVersion: "v1", keys: { v1: KEY } },
    );
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("POST", "/rest/v1/rpc/api_get_calendar_attention", () => ({
      outcome: "found",
      attention: attentionRow(),
    }));
    sb.on("GET", "/rest/v1/calendar_connections", () => [{
      id: CONNECTION_ID,
      provider: "google",
      provider_account_id: "dana@example.com",
      selected_calendar_id: "primary",
      selected_calendar_timezone: "America/Edmonton",
      credential_generation: 12,
    }]);
    sb.on("POST", "/rest/v1/rpc/api_claim_calendar_credential_refresh", () => ({
      outcome: "claimed",
      credential_generation: 12,
      credential_ciphertext: sealed.ciphertext,
      credential_iv: sealed.iv,
      credential_key_version: sealed.keyVersion,
    }));
    sb.on("POST", "/rest/v1/rpc/api_commit_calendar_credential_refresh", () => ({
      outcome: "superseded",
      credential_generation: 13,
    }));
    let providerReads = 0;
    const providerRoute = async (url: URL) => {
      if (url.href === "https://oauth2.googleapis.com/token") {
        return Response.json({
          access_token: "stale-access-token",
          expires_in: 3600,
        });
      }
      if (url.hostname === "www.googleapis.com") providerReads += 1;
      return undefined;
    };
    stubFetch(jwksRoute(auth), providerRoute, sb.route);

    const response = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calendar/attention/${LINK_ID}/resolve`,
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: { action: "use_calendar" },
      },
    );

    expect(response.status).toBe(409);
    expect(providerReads).toBe(0);
    expect(
      sb.find("POST", "/rest/v1/rpc/api_retry_calendar_credential_refresh"),
    ).toHaveLength(0);
    expect(
      sb.find("POST", "/rest/v1/rpc/api_resolve_calendar_conflict"),
    ).toHaveLength(0);
  });

  it("requires and passes a new instant for the Moved removal answer", async () => {
    const env = configuredEnv();
    const sb = supabaseStub(env);
    sb.on(
      "POST",
      "/rest/v1/rpc/api_authorize_request",
      membershipResponder(MEMBER_ID, "member"),
    );
    sb.on("POST", "/rest/v1/rpc/api_get_calendar_attention", () => ({
      outcome: "found",
      attention: attentionRow("event_removed"),
    }));
    sb.on(
      "POST",
      "/rest/v1/rpc/api_resolve_calendar_event_removed",
      () => ({ outcome: "moved", generation: 1 }),
    );
    stubFetch(jwksRoute(auth), sb.route);

    const missing = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calendar/attention/${LINK_ID}/resolve`,
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: { action: "moved" },
      },
    );
    expect(missing.status).toBe(422);
    expect(
      sb.find("POST", "/rest/v1/rpc/api_resolve_calendar_event_removed"),
    ).toHaveLength(0);

    const moved = await apiRequest(
      app,
      env,
      await auth.token(),
      `/v1/calendar/attention/${LINK_ID}/resolve`,
      {
        method: "POST",
        companyId: COMPANY_ID,
        body: {
          action: "moved",
          new_due_at: "2026-11-04T17:00:00.000Z",
        },
      },
    );
    expect(moved.status).toBe(200);
    expect(
      sb.find(
        "POST",
        "/rest/v1/rpc/api_resolve_calendar_event_removed",
      )[0].body,
    ).toEqual({
      p_company_id: COMPANY_ID,
      p_user_id: auth.subject,
      p_link_id: LINK_ID,
      p_answer: "moved",
      p_new_due_at: "2026-11-04T17:00:00.000Z",
    });
  });
});
