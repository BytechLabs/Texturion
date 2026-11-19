import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  apiRequest,
  buildTestApp,
  membershipResponder,
  supabaseStub,
} from "../test/routes-harness";
import { completeEnv, createTestAuth, jwksRoute, stubFetch } from '../test/support';
import type { TestAuth } from '../test/support';
import { Hono } from "hono";
import type { AppEnv } from "../context";
import { calendarRoutes } from "./calendar";
import { calendarFeedRoutes } from "./calendar-feed";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";

let auth: TestAuth;
const app = buildTestApp(calendarRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the calendar feed link", () => {
  it("names the API host, which serves the feed", async () => {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_authorize_request", membershipResponder(MEMBER_ID, "member"));
    sb.on("POST", "/rest/v1/rpc/api_mint_calendar_feed_token", () => "minted");
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calendar/feed", {
      method: "POST",
      companyId: COMPANY_ID,
    });

    expect(res.status).toBe(201);
    const { url } = (await res.json()) as { url: string };
    expect(url.startsWith(`${env.API_ORIGIN}/calendar/`)).toBe(true);
    expect(url.endsWith("/schedule.ics")).toBe(true);
    expect(url.startsWith(env.APP_ORIGIN)).toBe(false);
  });

  it("does not return a URL if access ended before minting", async () => {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_authorize_request", membershipResponder(MEMBER_ID, "member"));
    sb.on("POST", "/rest/v1/rpc/api_mint_calendar_feed_token", () => null);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await apiRequest(app, env, await auth.token(), "/v1/calendar/feed", {
      method: "POST",
      companyId: COMPANY_ID,
    });

    expect(res.status).toBe(404);
  });
});

describe("the calendar feed answers the app's own page", () => {
  const feedApp = new Hono<AppEnv>();
  const feedPath = "/calendar/abcdefghijklmnopqrstuvwxyz/schedule.ics";
  feedApp.route("/", calendarFeedRoutes);

  it("lets the app origin read the answer, so the page can check the link", async () => {
    const res = await feedApp.request(
      "/calendar/short/schedule.ics",
      { headers: { Origin: env.APP_ORIGIN } },
      env,
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBe(env.APP_ORIGIN);
  });

  it("links every event back to its task, in the URL and the description (#751)", async () => {
    const taskId = "5e3f1a2b-7c4d-4e6f-8a9b-0c1d2e3f4a5b";
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_resolve_calendar_feed_token", () => [
      { company_id: COMPANY_ID, user_id: MEMBER_ID, role: "member", company_name: "Northside Plumbing" },
    ]);
    sb.on("POST", "/rest/v1/rpc/api_calendar_feed_tasks", () => [
      {
        id: taskId,
        title: "Boiler repair",
        description: "Bring ladder",
        due_at: new Date(Date.now() + 86_400_000).toISOString(),
        updated_at: null,
      },
    ]);
    stubFetch(sb.route);

    const res = await feedApp.request(feedPath, {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store, private");
    expect(sb.find("POST", "/rest/v1/rpc/api_calendar_feed_tasks")[0].body).toMatchObject({
      p_company_id: COMPANY_ID,
      p_user_id: MEMBER_ID,
      p_since: expect.any(String),
    });
    // Unfold the ics line wrapping before reading the fields.
    const body = (await res.text()).replaceAll(/\r\n[ \t]/g, "");
    const taskUrl = `${env.APP_ORIGIN}/tasks/${taskId}`;
    expect(body).toContain(`URL:${taskUrl}`);
    expect(body).toContain(`DESCRIPTION:Bring ladder\\n\\nOpen in Loonext: ${taskUrl}`);
  });

  it("does not fetch tasks for a role without conversation access", async () => {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_resolve_calendar_feed_token", () => [
      { company_id: COMPANY_ID, user_id: MEMBER_ID, role: "bookkeeper", company_name: "Northside Plumbing" },
    ]);
    stubFetch(sb.route);

    const res = await feedApp.request(feedPath, {}, env);

    expect(res.status).toBe(404);
    expect(sb.find("POST", "/rest/v1/rpc/api_calendar_feed_tasks")).toHaveLength(0);
  });

  it("does not open the feed to any other origin", async () => {
    const res = await feedApp.request(
      "/calendar/short/schedule.ics",
      { headers: { Origin: "https://elsewhere.example" } },
      env,
    );
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
