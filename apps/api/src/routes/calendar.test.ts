import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  apiRequest,
  buildTestApp,
  membershipResponder,
  supabaseStub,
} from "../test/routes-harness";
import { completeEnv, createTestAuth, jwksRoute, stubFetch, type TestAuth } from "../test/support";
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
});

describe("the calendar feed answers the app's own page", () => {
  const feedApp = new Hono<AppEnv>();
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

  it("does not open the feed to any other origin", async () => {
    const res = await feedApp.request(
      "/calendar/short/schedule.ics",
      { headers: { Origin: "https://elsewhere.example" } },
      env,
    );
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
