/**
 * #694: per-member mute and follow routes. The write is keyed to the caller,
 * mute and follow do not overwrite each other, and the state rides back on the
 * list and the detail.
 */
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
import { conversationsRoutes } from "./conversations";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const CONV_ID = "aaaaaaaa-1111-4222-8333-444444444444";

let auth: TestAuth;
const app = buildTestApp(conversationsRoutes);

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function world(options: { found?: boolean; stored?: unknown[] } = {}) {
  const sb = supabaseStub(env);
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, "member"),
  );
  sb.on("POST", "/rest/v1/rpc/member_number_levels", () => []);
  sb.on("GET", "/rest/v1/conversations", () =>
    options.found === false
      ? []
      : [
          {
            id: CONV_ID,
            company_id: COMPANY_ID,
            phone_number_id: "eeeeeeee-1111-4222-8333-444444444444",
          },
        ],
  );
  const writes: { method: string; body: unknown; url: URL }[] = [];
  sb.on("POST", "/rest/v1/conversation_member_prefs", (req) => {
    writes.push({ method: "POST", body: req.body, url: req.url });
    return new Response(null, { status: 201 });
  });
  sb.on("DELETE", "/rest/v1/conversation_member_prefs", (req) => {
    writes.push({ method: "DELETE", body: null, url: req.url });
    return new Response(null, { status: 204 });
  });
  sb.on("GET", "/rest/v1/conversation_member_prefs", () => options.stored ?? []);
  return { sb, writes };
}

async function call(
  sb: ReturnType<typeof world>["sb"],
  path: string,
  method: "PUT" | "DELETE",
  body?: unknown,
) {
  stubFetch(jwksRoute(auth), sb.route);
  return apiRequest(app, env, await auth.token(), `/v1/conversations/${CONV_ID}${path}`, {
    method,
    companyId: COMPANY_ID,
    ...(body === undefined ? {} : { body }),
  });
}

describe("#694 mute", () => {
  it("mutes for a named duration, keyed to the caller", async () => {
    const { sb, writes } = world();
    const before = Date.now();
    const res = await call(sb, "/mute", "PUT", { duration: "8h" });
    expect(res.status).toBe(200);
    const upsert = writes.find((w) => w.method === "POST");
    expect(upsert?.body).toMatchObject({
      company_id: COMPANY_ID,
      conversation_id: CONV_ID,
      user_id: auth.subject,
      muted: true,
    });
    const until = Date.parse(
      (upsert?.body as { muted_until: string }).muted_until,
    );
    expect(until - before).toBeGreaterThan(8 * 3_600_000 - 5_000);
    expect(until - before).toBeLessThan(8 * 3_600_000 + 5_000);
    // Follow is not in the upsert, so muting never rewrites it.
    expect(upsert?.body).not.toHaveProperty("followed");
  });

  it("forever, and until null, both store no deadline", async () => {
    for (const body of [{ duration: "forever" }, { until: null }]) {
      const { sb, writes } = world();
      const res = await call(sb, "/mute", "PUT", body);
      expect(res.status).toBe(200);
      expect(writes.find((w) => w.method === "POST")?.body).toMatchObject({
        muted: true,
        muted_until: null,
      });
    }
  });

  it("refuses a deadline in the past", async () => {
    const { sb, writes } = world();
    const res = await call(sb, "/mute", "PUT", {
      until: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(res.status).toBe(422);
    expect(writes).toHaveLength(0);
  });

  it("refuses an unknown duration", async () => {
    const { sb } = world();
    expect((await call(sb, "/mute", "PUT", { duration: "2d" })).status).toBe(422);
  });

  it("answers the member's state, and a mute that has ended reads as not muted", async () => {
    const { sb } = world({
      stored: [
        {
          user_id: auth.subject,
          muted: true,
          muted_until: new Date(Date.now() - 1000).toISOString(),
          followed: true,
        },
      ],
    });
    const res = await call(sb, "/mute", "PUT", { duration: "1h" });
    expect(await res.json()).toEqual({
      muted: false,
      muted_until: null,
      followed: true,
    });
  });

  it("unmute clears the mute and leaves follow alone", async () => {
    const { sb, writes } = world();
    const res = await call(sb, "/mute", "DELETE");
    expect(res.status).toBe(200);
    const upsert = writes.find((w) => w.method === "POST");
    expect(upsert?.body).toMatchObject({ muted: false, muted_until: null });
    expect(upsert?.body).not.toHaveProperty("followed");
  });

  it("404s a conversation outside the company", async () => {
    const { sb, writes } = world({ found: false });
    const res = await call(sb, "/mute", "PUT", { duration: "1h" });
    expect(res.status).toBe(404);
    expect(writes).toHaveLength(0);
  });

  it("sends nothing to anyone: muting is not a notification", async () => {
    const { sb } = world();
    await call(sb, "/mute", "PUT", { duration: "1h" });
    expect(
      sb.calls.filter((c) => c.path.includes("push_subscriptions")),
    ).toHaveLength(0);
  });
});

describe("#694 follow", () => {
  it("follows and unfollows without touching mute", async () => {
    const { sb, writes } = world();
    expect((await call(sb, "/follow", "PUT")).status).toBe(200);
    const follow = writes.find((w) => w.method === "POST");
    expect(follow?.body).toMatchObject({ user_id: auth.subject, followed: true });
    expect(follow?.body).not.toHaveProperty("muted");

    const second = world();
    expect((await call(second.sb, "/follow", "DELETE")).status).toBe(200);
    expect(second.writes.find((w) => w.method === "POST")?.body).toMatchObject({
      followed: false,
    });
  });

  it("tidies a row that says nothing", async () => {
    const { sb, writes } = world();
    await call(sb, "/follow", "DELETE");
    const tidy = writes.find((w) => w.method === "DELETE");
    expect(tidy?.url.searchParams.get("muted")).toBe("eq.false");
    expect(tidy?.url.searchParams.get("followed")).toBe("eq.false");
    expect(tidy?.url.searchParams.get("user_id")).toBe(`eq.${auth.subject}`);
  });
});

describe("#694 list flags", () => {
  it("marks a muted and a followed row, and leaves the rest false", async () => {
    const other = "bbbbbbbb-1111-4222-8333-444444444444";
    const { sb } = world({
      stored: [
        {
          conversation_id: CONV_ID,
          user_id: auth.subject,
          muted: true,
          muted_until: null,
          followed: false,
        },
      ],
    });
    sb.on("POST", "/rest/v1/rpc/api_list_conversations", () => [
      { id: CONV_ID, last_message_at: "2026-07-01T10:00:00+00:00" },
      { id: other, last_message_at: "2026-07-01T09:00:00+00:00" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);
    const res = await apiRequest(app, env, await auth.token(), "/v1/conversations", {
      companyId: COMPANY_ID,
    });
    const page = (await res.json()) as {
      data: { id: string; muted: boolean; followed: boolean }[];
    };
    expect(page.data.map((r) => [r.id, r.muted, r.followed])).toEqual([
      [CONV_ID, true, false],
      [other, false, false],
    ]);
  });
});
