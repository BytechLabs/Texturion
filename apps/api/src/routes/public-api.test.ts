/**
 * #243 — the public API's door.
 *
 * The assertions that matter are the refusals. A public surface's whole risk
 * is that something reaches it which should not: an unknown token, a revoked
 * one, a key whose creator has left the workspace, or a key holding one scope
 * being used for another. Each of those is a separate failure and each is
 * pinned here.
 *
 * Only the network edge is stubbed, so the token hashing is real SHA-256 and
 * the request bodies go through real supabase-js encoding.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { API_KEY_PREFIX, PUBLIC_API_VERSION_HEADER } from "@loonext/shared";

import { Hono } from "hono";

import type { AppEnv } from "../context";
import { ApiError, errorResponse } from "../http/errors";
import {
  membershipResponder,
  supabaseStub,
  type SupabaseStub,
} from "../test/routes-harness";
import {
  completeEnv,
  createTestAuth,
  jwksRoute,
  stubFetch,
  type TestAuth,
} from "../test/support";
import { stripComments } from "../test/source-tree";
import { publicApiRoutes } from "./public-api";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const MEMBER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";
const CREATOR = "6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01";
const KEY_ID = "cccccccc-1111-4222-8333-444444444444";
const CONVERSATION_ID = "dddddddd-1111-4222-8333-444444444444";
const TOKEN = `${API_KEY_PREFIX}0123456789abcdef0123456789abcdef`;

let auth: TestAuth;

/**
 * The public surface mounts at the ROOT, not under `/v1`, and carries its own
 * credential instead of the JWT + company-context chain.
 *
 * So it cannot use `buildTestApp`, which exists to reproduce that chain — and
 * using it would be worse than inconvenient: the routes would answer behind a
 * member session, which is the one thing this surface must never require. This
 * mirrors `index.ts`'s mount exactly, including the shared `onError`, so a
 * refusal here is shaped like a refusal in production.
 */
const app = new Hono<AppEnv>();
app.route("/", publicApiRoutes);
app.notFound((c) => errorResponse(c, "not_found", "No such route."));
app.onError((error, c) => {
  if (error instanceof ApiError) return errorResponse(c, error.code, error.message);
  throw error;
});

beforeAll(async () => {
  auth = await createTestAuth(env);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A stub where the token resolves and its creator is an active member.
 *
 * `scopes` is the knob every test below turns; the point of the surface is
 * that holding one scope grants exactly one thing.
 */
function stubWithKey(scopes: string[], role = "owner"): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on("POST", "/rest/v1/rpc/api_resolve_key", () => [
    { id: KEY_ID, company_id: COMPANY_ID, scopes, created_by: CREATOR },
  ]);
  sb.on(
    "POST",
    "/rest/v1/rpc/api_authorize_request",
    membershipResponder(MEMBER_ID, role),
  );
  return sb;
}

/** A public request carries a key, never a session or a company header. */
function publicRequest(path: string, init: RequestInit = {}) {
  return app.request(
    `http://localhost${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        ...((init.headers as Record<string, string> | undefined) ?? {}),
      },
    },
    env,
  );
}

describe("the door", () => {
  it("answers with the version on every response, including refusals", async () => {
    const sb = supabaseStub(env);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await app.request(
      "http://localhost/public/v1/me",
      { headers: {} },
      env,
    );
    expect(res.status).toBe(401);
    // A client that pins nothing still gets told what answered, which is what
    // turns "our integration broke" into a report with a fact in it.
    expect(res.headers.get(PUBLIC_API_VERSION_HEADER)).toBe("v1");
  });

  it("never reaches the database for something that is not one of our tokens", async () => {
    const sb = supabaseStub(env);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await app.request(
      "http://localhost/public/v1/me",
      { headers: { Authorization: "Bearer hunter2" } },
      env,
    );
    expect(res.status).toBe(401);
    // The prefix check is what keeps an unauthenticated request costing a
    // string comparison instead of a lookup.
    expect(sb.find("POST", "/rest/v1/rpc/api_resolve_key")).toHaveLength(0);
  });

  it("refuses an unknown, revoked or expired key with one indistinguishable answer", async () => {
    const sb = supabaseStub(env);
    // The RPC answers with nothing for all three cases, on purpose.
    sb.on("POST", "/rest/v1/rpc/api_resolve_key", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/me");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string } };
    // Nothing in the answer says which of the three it was — a public endpoint
    // that distinguishes them tells whoever is guessing which guess was real.
    expect(body.error.message).toBe("That API key is not valid.");
  });

  it("stops working when the creator is no longer an active member", async () => {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_resolve_key", () => [
      { id: KEY_ID, company_id: COMPANY_ID, scopes: ["contacts:read"], created_by: CREATOR },
    ]);
    // No membership: the person was deactivated or removed.
    sb.on("POST", "/rest/v1/rpc/api_authorize_request", () => ({
      session_revoked: false,
      session_new: false,
      member: null,
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/contacts");
    // THE ONE THAT MATTERS. A key must never become a way to keep an access
    // that has been withdrawn, and the membership is resolved live on every
    // request precisely so this cannot be cached into being true.
    expect(res.status).toBe(403);
    // Asserted by MESSAGE, not just status, and that is not fussiness. With
    // only the status, this test passed while the membership check was
    // disabled — the capability gate downstream refused a caller with no role
    // and produced the same 403. A guard whose answer is indistinguishable
    // from its neighbour's is measuring the neighbour.
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("no longer active in this workspace");
  });

  it("does not reach the workspace's data when the creator has left", async () => {
    // The other half of the same claim: refusing is not enough if the query
    // already ran. Nothing below the middleware may execute.
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_resolve_key", () => [
      { id: KEY_ID, company_id: COMPANY_ID, scopes: ["contacts:read"], created_by: CREATOR },
    ]);
    sb.on("POST", "/rest/v1/rpc/api_authorize_request", () => ({
      session_revoked: false,
      session_new: false,
      member: null,
    }));
    stubFetch(jwksRoute(auth), sb.route);

    await publicRequest("/public/v1/contacts");
    expect(sb.find("GET", "/rest/v1/contacts")).toHaveLength(0);
  });

  it("says what the key is and what it may do, without needing a scope to ask", async () => {
    const sb = stubWithKey(["contacts:read", "tasks:write"]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      company_id: COMPANY_ID,
      key_id: KEY_ID,
      scopes: ["contacts:read", "tasks:write"],
    });
  });

  it("hashes the token rather than sending it", async () => {
    const sb = stubWithKey(["contacts:read"]);
    stubFetch(jwksRoute(auth), sb.route);

    await publicRequest("/public/v1/me");

    const call = sb.find("POST", "/rest/v1/rpc/api_resolve_key")[0];
    const body = call.body as { p_token_hash: string };
    expect(body.p_token_hash).toMatch(/^[0-9a-f]{64}$/);
    // The token itself must not appear anywhere in what we send.
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });
});

describe("scopes are the second gate", () => {
  it("lets a key read contacts when it holds contacts:read", async () => {
    const sb = stubWithKey(["contacts:read"]);
    sb.on("GET", "/rest/v1/contacts", () => [{ id: "ct-1", phone_e164: "+14165550100" }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/contacts");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; limit: number };
    expect(body.data).toHaveLength(1);
    expect(body.limit).toBe(25);

    const call = sb.find("GET", "/rest/v1/contacts")[0];
    expect(call.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    // The published column list is the enforcement — a `select("*")` here
    // would publish every internal column as a shape somebody parses.
    expect(call.url.searchParams.get("select")).not.toContain("custom_fields");
  });

  it("refuses a read to a key that can only write", async () => {
    // Write does not imply read. A key that may create a contact has no
    // business enumerating the customer list.
    const sb = stubWithKey(["contacts:write"]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/contacts");
    expect(res.status).toBe(403);
    expect(sb.find("GET", "/rest/v1/contacts")).toHaveLength(0);
  });

  it("refuses a write to a key that can only read", async () => {
    const sb = stubWithKey(["contacts:read"]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/contacts", {
      method: "POST",
      body: JSON.stringify({ phone_e164: "+14165550100" }),
    });
    expect(res.status).toBe(403);
    expect(sb.find("POST", "/rest/v1/contacts")).toHaveLength(0);
  });

  it("refuses every route to a key holding no scope at all", async () => {
    const sb = stubWithKey([]);
    stubFetch(jwksRoute(auth), sb.route);

    for (const path of ["/public/v1/contacts", "/public/v1/tasks"]) {
      const res = await publicRequest(path);
      expect(res.status, path).toBe(403);
    }
  });

  it("still applies the CREATOR's capability, not just the key's scope", async () => {
    // A bookkeeper holds billing and nothing else (#315). Their key carries
    // their role, so the same scopes reach less than an owner's would — which
    // is the whole point of a key acting AS the person who made it.
    const sb = stubWithKey(["contacts:read"], "bookkeeper");
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/contacts");
    expect(res.status).toBe(403);
    expect(sb.find("GET", "/rest/v1/contacts")).toHaveLength(0);
  });
});

describe("#106 travels with the key", () => {
  it("filters the conversation list by the CREATOR's number access", async () => {
    // A restricted MEMBER, not an owner: resolveNumberAccess short-circuits
    // to unrestricted for owner/admin, so an owner here would exercise none of
    // the deny-list path this test is about.
    const sb = stubWithKey(["conversations:read"], "member");
    sb.on("POST", "/rest/v1/rpc/member_number_levels", () => [
      { phone_number_id: "nnnnnnnn-1111-4222-8333-444444444444", level: "none" },
    ]);
    sb.on("POST", "/rest/v1/rpc/api_list_conversations", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/conversations");
    expect(res.status).toBe(200);

    // THE ONE THAT MATTERS. A key must not enumerate conversations on a number
    // its creator cannot see, and the deny list has to reach the query — not
    // merely be computed and dropped.
    const call = sb.find("POST", "/rest/v1/rpc/api_list_conversations")[0];
    const body = call.body as { p_hidden_number_ids: string[] };
    expect(body.p_hidden_number_ids).toEqual([
      "nnnnnnnn-1111-4222-8333-444444444444",
    ]);
  });

  it("404s a thread on a number the creator cannot see", async () => {
    const sb = stubWithKey(["messages:read"], "member");
    sb.on("POST", "/rest/v1/rpc/member_number_levels", () => [
      { phone_number_id: "nnnnnnnn-1111-4222-8333-444444444444", level: "none" },
    ]);
    // The conversation exists, on the denied number.
    sb.on("GET", "/rest/v1/conversations", (call) =>
      call.url.searchParams.get("select") === "created_at"
        ? []
        : [{ id: CONVERSATION_ID, phone_number_id: "nnnnnnnn-1111-4222-8333-444444444444" }],
    );
    sb.on("GET", "/rest/v1/messages", () => [{ id: "m-1" }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest(`/public/v1/conversations/${CONVERSATION_ID}/messages`);
    // 404, not 403: a thread on a hidden number is indistinguishable from one
    // that does not exist, which is what stops a key probing for them.
    expect(res.status).toBe(404);
    expect(sb.find("GET", "/rest/v1/messages")).toHaveLength(0);
  });

  it("reads a thread the creator can see, scoped to the workspace", async () => {
    const sb = stubWithKey(["messages:read"]);
    sb.on("GET", "/rest/v1/conversations", (call) =>
      call.url.searchParams.get("select") === "created_at"
        ? []
        : [{ id: CONVERSATION_ID, phone_number_id: null }],
    );
    sb.on("GET", "/rest/v1/messages", () => [
      { id: "m-1", direction: "inbound", body: "the boiler is out" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest(`/public/v1/conversations/${CONVERSATION_ID}/messages`);
    expect(res.status).toBe(200);

    const call = sb.find("GET", "/rest/v1/messages")[0];
    expect(call.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
    expect(call.url.searchParams.get("conversation_id")).toBe(`eq.${CONVERSATION_ID}`);
    // A deliberate subset. Every column published becomes a shape somebody
    // parses, and `error_detail` is the carrier's sentence, not ours to promise.
    expect(call.url.searchParams.get("select")).not.toContain("error_detail");
  });
});

describe("sending", () => {
  it("refuses a send with no Idempotency-Key, before anything is written", async () => {
    // An integration retries — that is what makes it an integration — and a
    // send endpoint without a key turns every network blip into a second text
    // to a real customer.
    const sb = stubWithKey(["messages:send"]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/messages", {
      method: "POST",
      body: JSON.stringify({ conversation_id: CONVERSATION_ID, body: "on my way" }),
    });
    expect(res.status).toBe(422);
    expect(sb.find("POST", "/rest/v1/rpc/gate_outbound_send")).toHaveLength(0);
  });

  it("refuses a send to a key without messages:send, even one that can read", async () => {
    const sb = stubWithKey(["conversations:read", "messages:read"]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/messages", {
      method: "POST",
      headers: { "Idempotency-Key": "k-1" },
      body: JSON.stringify({ conversation_id: CONVERSATION_ID, body: "on my way" }),
    });
    // Reading a thread never grants the right to speak on the workspace's
    // number — the only scope that can put the business's number on a
    // stranger's phone is its own.
    expect(res.status).toBe(403);
  });

  it("owns no part of the send order — it delegates the whole sequence", () => {
    // THE ONE THAT MATTERS, and it is asserted on the SOURCE for the same
    // reason `send-paths.test.ts` is: the claim is about which code exists,
    // not about what one request did. Opt-out is carrier truth — a STOP can
    // only be lifted by the customer — and the danger is not that this route
    // gets the order wrong today. It is that it grows its own copy of it, and
    // the copy drifts.
    //
    // So: this file may call the shared sequence, and may not reach for any of
    // the pieces the sequence is made of.
    const source = stripComments(
      readFileSync(join(import.meta.dirname, "public-api.ts"), "utf8"),
    );

    expect(source).toContain("sendTextToConversation(");
    for (const piece of [
      "runPreSendGates(",
      "gateOutboundSend(",
      "dispatchOutbound(",
      "applySendMergeFields(",
    ]) {
      expect(
        source.includes(piece),
        `public-api.ts calls ${piece} directly — that is a second copy of the ` +
          `send order, and the opt-out gate is the part that must never have one.`,
      ).toBe(false);
    }
  });
});

describe("writes", () => {
  it("upserts a contact so a connector replaying its queue does not duplicate", async () => {
    const sb = stubWithKey(["contacts:write"]);
    sb.on("POST", "/rest/v1/contacts", () => [
      { id: "ct-1", phone_e164: "+14165550100" },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/contacts", {
      method: "POST",
      body: JSON.stringify({ phone_e164: "+14165550100", name: "Maria Alvarez" }),
    });
    expect(res.status).toBe(201);

    const call = sb.find("POST", "/rest/v1/contacts")[0];
    // A replayed queue is the normal case for an integration, not the
    // exception, so the conflict target has to be the one the first-party
    // route uses.
    expect(call.url.searchParams.get("on_conflict")).toBe("company_id,phone_e164");
    expect(call.body).toMatchObject({
      company_id: COMPANY_ID,
      phone_e164: "+14165550100",
      name: "Maria Alvarez",
      created_by_user_id: CREATOR,
    });
  });

  it("creates a task through the same RPC the first-party route uses", async () => {
    const sb = stubWithKey(["tasks:write"]);
    sb.on("POST", "/rest/v1/rpc/create_task", () => ({
      outcome: "created",
      task: { id: "tk-1", title: "Fix the boiler" },
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/tasks", {
      method: "POST",
      body: JSON.stringify({
        message_id: "11111111-1111-4111-8111-111111111111",
        title: "Fix the boiler",
      }),
    });
    expect(res.status).toBe(201);

    // A public path that wrote the table directly would be a second way to
    // create a task, and the second way is the one that forgets the audit row.
    const call = sb.find("POST", "/rest/v1/rpc/create_task")[0];
    expect(call.body).toMatchObject({
      p_company_id: COMPANY_ID,
      p_actor_user_id: CREATOR,
      p_title: "Fix the boiler",
    });
  });

  it("reports an already-promoted message as a conflict rather than a 500", async () => {
    const sb = stubWithKey(["tasks:write"]);
    sb.on("POST", "/rest/v1/rpc/create_task", () => ({ outcome: "conflict" }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/tasks", {
      method: "POST",
      body: JSON.stringify({ message_id: "11111111-1111-4111-8111-111111111111" }),
    });
    expect(res.status).toBe(409);
  });

  it("bounds a page even when the caller asks for everything", async () => {
    const sb = stubWithKey(["tasks:read"]);
    sb.on("GET", "/rest/v1/tasks", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/tasks?limit=100000");
    expect(res.status).toBe(200);
    expect((await res.json()) as { limit: number }).toMatchObject({ limit: 100 });
  });
});

describe("REST hooks — how Zapier and Make actually work", () => {
  it("subscribes, records the key that did it, and shows the secret once", async () => {
    const sb = stubWithKey(["webhooks:manage", "tasks:read"]);
    sb.on("POST", "/rest/v1/webhook_endpoints", () => [
      { id: "wh-1", url: "https://hooks.zapier.com/x", events: ["task.created"] },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/webhooks", {
      method: "POST",
      body: JSON.stringify({
        url: "https://hooks.zapier.com/x",
        events: ["task.created"],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { secret_once: string };
    expect(body.secret_once.startsWith("whsec_")).toBe(true);

    const insert = sb.find("POST", "/rest/v1/webhook_endpoints")[0].body as {
      created_by_api_key_id: string;
      secret: string;
    };
    // The bound that makes unsubscribe safe: the endpoint remembers which key
    // made it.
    expect(insert.created_by_api_key_id).toBe(KEY_ID);
    expect(insert.secret).toBe(body.secret_once);
  });

  it("refuses an address the settings screen would refuse", async () => {
    // A connector is not more trusted than a person. Same SSRF gate.
    const sb = stubWithKey(["webhooks:manage", "tasks:read"]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/webhooks", {
      method: "POST",
      body: JSON.stringify({
        url: "https://169.254.169.254/latest/meta-data/",
        events: ["task.created"],
      }),
    });
    expect(res.status).toBe(422);
    expect(sb.find("POST", "/rest/v1/webhook_endpoints")).toHaveLength(0);
  });

  it("unsubscribes only what THIS key created", async () => {
    const sb = stubWithKey(["webhooks:manage", "tasks:read"]);
    sb.on("DELETE", "/rest/v1/webhook_endpoints", () => [{ id: "wh-1" }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest(
      "/public/v1/webhooks/dddddddd-1111-4222-8333-444444444444",
      { method: "DELETE" },
    );
    expect(res.status).toBe(204);

    // THE ONE THAT MATTERS. Without this filter a Zap could tear down a
    // webhook the same person set up by hand in Settings, or one belonging to
    // a different Zap — invisible until the messages stopped arriving.
    const call = sb.find("DELETE", "/rest/v1/webhook_endpoints")[0];
    expect(call.url.searchParams.get("created_by_api_key_id")).toBe(`eq.${KEY_ID}`);
    expect(call.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
  });

  it("404s a webhook this key did not create", async () => {
    const sb = stubWithKey(["webhooks:manage", "tasks:read"]);
    // The filtered delete matches nothing — somebody else's endpoint.
    sb.on("DELETE", "/rest/v1/webhook_endpoints", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest(
      "/public/v1/webhooks/dddddddd-1111-4222-8333-444444444444",
      { method: "DELETE" },
    );
    expect(res.status).toBe(404);
  });

  it("refuses both routes to a key without the scope", async () => {
    const sb = stubWithKey(["tasks:read", "contacts:read"]);
    stubFetch(jwksRoute(auth), sb.route);

    const created = await publicRequest("/public/v1/webhooks", {
      method: "POST",
      body: JSON.stringify({ url: "https://hooks.example.com/x", events: ["task.created"] }),
    });
    expect(created.status).toBe(403);

    const removed = await publicRequest(
      "/public/v1/webhooks/dddddddd-1111-4222-8333-444444444444",
      { method: "DELETE" },
    );
    expect(removed.status).toBe(403);
  });
});

describe("#243 acceptance: a key cannot reach a number its owner cannot", () => {
  /**
   * The issue's fourth acceptance line, asserted on every route that touches a
   * number rather than on the one that was easiest to stub.
   *
   * Three routes reach conversation data: the thread list, one thread's
   * messages, and the send. Each resolves #106 through a different helper, so
   * "the send is fine because the list is" is not an argument — it is the
   * assumption that leaves one of three open.
   */
  const HIDDEN = "nnnnnnnn-1111-4222-8333-444444444444";

  /** A restricted MEMBER: owner/admin short-circuit to unrestricted. */
  function restrictedKey(scopes: string[]): SupabaseStub {
    const sb = stubWithKey(scopes, "member");
    sb.on("POST", "/rest/v1/rpc/member_number_levels", () => [
      { phone_number_id: HIDDEN, level: "none" },
    ]);
    return sb;
  }

  it("the thread list is filtered by the deny list", async () => {
    const sb = restrictedKey(["conversations:read"]);
    sb.on("POST", "/rest/v1/rpc/api_list_conversations", () => []);
    stubFetch(jwksRoute(auth), sb.route);

    await publicRequest("/public/v1/conversations");

    const body = sb.find("POST", "/rest/v1/rpc/api_list_conversations")[0].body as {
      p_hidden_number_ids: string[];
    };
    expect(body.p_hidden_number_ids).toEqual([HIDDEN]);
  });

  it("a thread on a hidden number 404s, and its messages are never read", async () => {
    const sb = restrictedKey(["messages:read"]);
    sb.on("GET", "/rest/v1/conversations", (call) =>
      call.url.searchParams.get("select") === "created_at"
        ? []
        : [{ id: CONVERSATION_ID, phone_number_id: HIDDEN }],
    );
    sb.on("GET", "/rest/v1/messages", () => [{ id: "m-1" }]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest(
      `/public/v1/conversations/${CONVERSATION_ID}/messages`,
    );
    expect(res.status).toBe(404);
    expect(sb.find("GET", "/rest/v1/messages")).toHaveLength(0);
  });

  it("a send to a hidden number is refused before the carrier is reached", async () => {
    // THE ONE MOST WORTH PINNING. The send runs the deny list through a THIRD
    // helper — `assertNumberLevel` with need "text", inside the shared
    // sequence — so it is the route where "the others are filtered" proves
    // nothing at all.
    const sb = restrictedKey(["messages:send"]);
    sb.on("GET", "/rest/v1/conversations", (call) =>
      call.url.searchParams.get("select") === "created_at"
        ? []
        : [
            {
              id: CONVERSATION_ID,
              contact_id: "ct-1",
              phone_number_id: HIDDEN,
              contact_phone_e164: "+14165550100",
              contacts: { id: "ct-1", name: "Maria", address: null, timezone: null },
              phone_numbers: { id: HIDDEN, number_e164: "+14165550111", status: "active" },
              companies: { id: COMPANY_ID, name: "Ace Plumbing" },
            },
          ],
    );
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/messages", {
      method: "POST",
      headers: { "Idempotency-Key": "k-1" },
      body: JSON.stringify({ conversation_id: CONVERSATION_ID, body: "on my way" }),
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    // Nothing was queued and nothing reached Telnyx.
    expect(sb.find("POST", "/rest/v1/rpc/gate_outbound_send")).toHaveLength(0);
  });
});

/**
 * #581 finding 3 — `webhooks:manage` is not a read-everything scope.
 *
 * ## What it was
 *
 * A key granted ONLY `webhooks:manage` — the scope a customer grants a Zapier
 * or Make connector believing it can do nothing but manage its own
 * subscription — was refused by `GET /public/v1/messages`, `/conversations`
 * and `/contacts`. It then subscribed to `message.received` and received, from
 * the next inbound text onward, every message body with both E.164 numbers,
 * every Whisper voicemail transcript, and every new contact — pushed to a URL
 * of its own choosing.
 *
 * ## Why two gates did not stop it
 *
 * `requireScope("webhooks:manage")` asked for the wrong thing, and
 * `requireCapability("settings.manage")` asks about the ROLE OF THE PERSON WHO
 * MINTED THE KEY rather than about the key's own delegation — so a key narrowed
 * to nothing still passed it. That is the exact failure the two-gate design was
 * written to prevent, and it defeated the invariant the feature's own migration
 * is named for: `a_key_can_do_less_than_the_person_who_made_it`.
 *
 * The three existing subscribe tests all used `task.created`, so none of them
 * ever asked a key to reach data it could not already read.
 */
describe("#581 a key cannot subscribe past its own scopes", () => {
  it("refuses message events to a key that cannot read messages", async () => {
    // THE ATTACK: the scope a connector is given, pointed at everything.
    const sb = stubWithKey(["webhooks:manage"]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/webhooks", {
      method: "POST",
      body: JSON.stringify({
        url: "https://hooks.zapier.com/x",
        events: ["message.received"],
      }),
    });

    expect(res.status).toBe(403);
    // The refusal NAMES the scope. A connector author reading "forbidden"
    // learns nothing, and the next thing they try is a broader key.
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("messages:read");
    // And nothing was created on the way to refusing.
    expect(sb.find("POST", "/rest/v1/webhook_endpoints")).toHaveLength(0);
  });

  it("refuses voicemail transcripts to a key that cannot read conversations", async () => {
    // The one whose payload is least obvious from its name: a voicemail event
    // carries a transcript of what the customer said.
    const sb = stubWithKey(["webhooks:manage"]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/webhooks", {
      method: "POST",
      body: JSON.stringify({
        url: "https://hooks.zapier.com/x",
        events: ["voicemail.received"],
      }),
    });

    expect(res.status).toBe(403);
    expect(
      ((await res.json()) as { error: { message: string } }).error.message,
    ).toContain("conversations:read");
  });

  it("refuses the whole subscription when one event of several is out of scope", async () => {
    // A mixed list must not be granted in part. Subscribing is one act, and a
    // partial grant would be a subscription the caller did not ask for.
    const sb = stubWithKey(["webhooks:manage", "tasks:read"]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/webhooks", {
      method: "POST",
      body: JSON.stringify({
        url: "https://hooks.zapier.com/x",
        events: ["task.created", "message.received"],
      }),
    });

    expect(res.status).toBe(403);
    expect(sb.find("POST", "/rest/v1/webhook_endpoints")).toHaveLength(0);
  });

  it("allows a key that genuinely holds the read scope", async () => {
    // The other half: a gate that refuses everybody is an outage, not a gate.
    const sb = stubWithKey(["webhooks:manage", "messages:read"]);
    sb.on("POST", "/rest/v1/webhook_endpoints", () => [
      {
        id: "wh-1",
        url: "https://hooks.zapier.com/x",
        events: ["message.received"],
      },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/webhooks", {
      method: "POST",
      body: JSON.stringify({
        url: "https://hooks.zapier.com/x",
        events: ["message.received"],
      }),
    });

    expect(res.status).toBe(201);
  });
});

/**
 * #581 — the public task route respects #106, like its first-party twin.
 *
 * `POST /public/v1/tasks` promotes a MESSAGE. Creating a task on a message the
 * key's creator cannot see is two things at once: work appearing on a thread
 * they are denied, and — because the task title defaults to the message body —
 * a way to read that body straight back out of the task list.
 *
 * `routes/tasks.ts` has made this check on the identical act since it shipped.
 * The public twin did not, which is the same shape of gap the quotes feature
 * had: a second route onto one capability, written without the check the first
 * one carries.
 */
describe("#581 a key cannot promote a message on a denied line", () => {
  const DENIED_NUMBER = "99999999-8888-4777-8666-555555555555";
  const MESSAGE_ID = "77777777-6666-4555-8444-333333333333";

  it("refuses when the key's creator cannot see the message's thread", async () => {
    const sb = stubWithKey(["tasks:write"], "member");
    sb.on("POST", "/rest/v1/rpc/member_number_levels", () => [
      { phone_number_id: DENIED_NUMBER, level: "none" },
    ]);
    sb.on("GET", "/rest/v1/messages", () => [
      { conversation_id: CONVERSATION_ID },
    ]);
    sb.on("GET", "/rest/v1/conversations", () => [
      { id: CONVERSATION_ID, phone_number_id: DENIED_NUMBER },
    ]);
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/tasks", {
      method: "POST",
      body: JSON.stringify({ message_id: MESSAGE_ID, title: "Fix the sink" }),
    });

    // 404, not 403: a thread on a number the creator cannot see must be
    // indistinguishable from one that does not exist.
    expect(res.status).toBe(404);
    // And nothing was written on the way to refusing.
    expect(sb.find("POST", "/rest/v1/rpc/create_task")).toHaveLength(0);
  });

  it("lets an unrestricted key through", async () => {
    // A check that refuses everybody is an outage, not a check.
    const sb = stubWithKey(["tasks:write"], "member");
    sb.on("POST", "/rest/v1/rpc/member_number_levels", () => []);
    sb.on("POST", "/rest/v1/rpc/create_task", () => ({
      task: { id: "task-1", title: "Fix the sink" },
    }));
    stubFetch(jwksRoute(auth), sb.route);

    const res = await publicRequest("/public/v1/tasks", {
      method: "POST",
      body: JSON.stringify({ message_id: MESSAGE_ID, title: "Fix the sink" }),
    });

    expect(res.status).not.toBe(404);
  });
});
