import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "../context";
import type { Bindings } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { FakeRest } from "../telnyx/test-support";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { quotesRoutes } from "./quotes";

/**
 * #287 — sending a quote SENDS IT.
 *
 * ## Why this file exists, in the words of the bug it is here to stop
 *
 * The send route used to mint two link tokens and return them for "whoever
 * composes the text". Nobody composed it: all three clients called send, took
 * the tokens and dropped them. The row flipped to `sent`, the strip read
 * "Waiting", the outstanding queue filled up with prices — and the customer
 * received nothing at all. It reached production.
 *
 * The only test the send had asserted a CAPABILITY: that a bookkeeper is
 * refused. Everything about whether a text existed was unasserted, which is
 * why a route that sent nothing looked finished. So the first assertion here is
 * the one nobody wrote: a message exists, and it carries the link.
 *
 * The harness is the payment ask's, because the two paths are now the same
 * pipeline and a second style of faking it would drift from the first.
 */

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const CONTACT_ID = "44444444-4444-4444-8444-444444444444";
const NUMBER_ID = "55555555-5555-4555-8555-555555555555";
const QUOTE_ID = "66666666-6666-4666-8666-666666666666";
const MESSAGE_ID = "77777777-7777-4777-8777-777777777777";

function buildHarness(
  options: { optedOut?: boolean; numberStatus?: string; quote?: Record<string, unknown> } = {},
) {
  const env = completeEnv();
  const rest = new FakeRest(env);
  rest.table("companies");
  rest.table("conversations");
  rest.table("contacts");
  rest.table("phone_numbers");
  rest.table("quotes");
  rest.table("public_links");
  rest.table("messages");
  rest.table("conversation_events");
  rest.table("audit_log");
  // The gates runPreSendGates consults. Empty means "nobody has opted out and
  // nothing is switched off", which is the ordinary case.
  rest.table("opt_outs");
  rest.table("feature_flag_overrides");
  rest.table("messaging_registrations");

  rest.insert("companies", { id: COMPANY_ID, name: "Northline Plumbing", country: "US" });
  rest.insert("contacts", { id: CONTACT_ID, name: "Maria" });
  rest.insert("phone_numbers", {
    id: NUMBER_ID,
    number_e164: "+14155550100",
    status: options.numberStatus ?? "active",
  });
  rest.insert("conversations", {
    id: CONVERSATION_ID,
    company_id: COMPANY_ID,
    contact_id: CONTACT_ID,
    phone_number_id: NUMBER_ID,
    contact_phone_e164: "+14155550199",
    // FakeRest does not resolve PostgREST embeds, so the joined shapes the
    // route selects are seeded on the row itself.
    phone_numbers: {
      number_e164: "+14155550100",
      status: options.numberStatus ?? "active",
    },
    companies: { name: "Northline Plumbing" },
  });
  rest.insert("quotes", {
    id: QUOTE_ID,
    company_id: COMPANY_ID,
    conversation_id: CONVERSATION_ID,
    contact_id: CONTACT_ID,
    amount_cents: 45_000,
    currency: "usd",
    description: "Replace the water heater",
    status: "draft",
    expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    sent_at: null,
    viewed_at: null,
    decided_at: null,
    message_id: null,
    ...options.quote,
  });

  rest.rpc("api_send_gates", () => ({
    subscription_active: true,
    aup_enforcement: "none",
    paused: false,
    registration_status: "approved",
  }));
  rest.rpc("api_evaluate_flags", () => ({}));
  rest.rpc("api_mint_public_link", () => "link-token-0001");
  rest.rpc("api_revoke_public_link", () => null);
  rest.rpc("gate_outbound_send", (args) => {
    if (options.optedOut) return { outcome: "opted_out" };
    // The real RPC inserts the row atomically with the gate; the double does
    // the same, because dispatch immediately updates it by id.
    const message = rest.insert("messages", {
      id: MESSAGE_ID,
      company_id: COMPANY_ID,
      conversation_id: CONVERSATION_ID,
      direction: "outbound",
      status: "queued",
      body: String(args.p_body ?? ""),
      segments: 1,
    });
    return { outcome: "queued", message };
  });

  const app = new Hono<AppEnv>();
  app.use("/v1/*", async (c, next) => {
    c.set("userId", OWNER_ID);
    c.set("companyId", COMPANY_ID);
    c.set("role", "owner");
    c.set("memberId", "m-1");
    await next();
  });
  app.route("/v1", quotesRoutes);
  app.onError((error, c) => {
    if (error instanceof ApiError) return errorResponse(c, error.code, error.message);
    return c.json({ error: { code: "internal_error", message: String(error) } }, 500);
  });

  const telnyxCalls: URL[] = [];
  const telnyx: FetchRoute = async (url) => {
    if (url.origin !== "https://api.telnyx.com") return undefined;
    telnyxCalls.push(url);
    return Response.json({ data: { id: "telnyx-msg-0001", parts: 2 } });
  };
  stubFetch(telnyx, rest.route());

  return {
    env,
    rest,
    telnyxCalls,
    send: () =>
      app.request(
        `/v1/quotes/${QUOTE_ID}/send`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
        env as unknown as Bindings,
      ),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("#287 POST /quotes/:id/send", () => {
  it("puts a text in the thread carrying the link", async () => {
    // THE ASSERTION NOBODY WROTE. The route returned 200 and marked the row
    // sent while no message existed, and every test passed.
    const harness = buildHarness();
    const response = await harness.send();
    expect(response.status).toBe(200);

    const messages = harness.rest.rows("messages");
    expect(messages, "no text was created for a sent quote").toHaveLength(1);
    const body = String(messages[0].body);
    expect(body).toContain("Northline Plumbing");
    expect(body).toContain("Replace the water heater");
    // The amount, so nobody has to open a link to learn what they are quoted.
    expect(body).toContain("450");
    /*
     * The link. Asserted by SHAPE rather than by a literal: the token is
     * generated in-process and only its SHA-256 is ever stored, so the value in
     * the text is not something a stub can dictate — which is the property that
     * makes the link safe in the first place.
     */
    expect(body).toMatch(new RegExp("/q/[A-Za-z0-9_-]{20,}"));
  });

  it("hands it to the carrier rather than only writing a row", async () => {
    // A queued message that never dispatches is the same silence with an extra
    // row in it.
    const harness = buildHarness();
    await harness.send();
    expect(harness.telnyxCalls.length).toBeGreaterThan(0);
  });

  it("records WHICH message carried it", async () => {
    // #287 opens with "nobody can answer what did we quote". The answer is the
    // message the customer received, not the row.
    const harness = buildHarness();
    await harness.send();
    const quote = harness.rest.rows("quotes")[0];
    expect(quote.message_id).toBe(MESSAGE_ID);
  });

  it("never returns the tokens", async () => {
    // They are the customer's, once, in a text they already have. Handing a
    // copy back to the sender is a credential with nothing to do — and it is
    // what made the old shape look finished while nothing was delivered.
    const harness = buildHarness();
    const body = (await (await harness.send()).json()) as Record<string, unknown>;
    expect(Object.keys(body)).not.toContain("view_token");
    expect(Object.keys(body)).not.toContain("accept_token");
    expect(body.effective_status).toBe("sent");
  });

  it("sends nothing to a contact who has opted out", async () => {
    /*
     * THE gate that matters. An opt-out can only be lifted by the customer —
     * carrier truth, not our policy — and a send path that goes around it is
     * the one that gets the number blocked.
     */
    const harness = buildHarness({ optedOut: true });
    const response = await harness.send();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(harness.rest.rows("messages")).toHaveLength(0);
    expect(harness.telnyxCalls).toHaveLength(0);
    // And the quote is NOT left claiming it was sent.
    expect(harness.rest.rows("quotes")[0].sent_at).toBeNull();
  });

  it("refuses when the thread's number cannot text", async () => {
    const harness = buildHarness({ numberStatus: "released" });
    const response = await harness.send();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(harness.rest.rows("messages")).toHaveLength(0);
  });

  it("refuses to send a quote twice", async () => {
    // Guarded in the WHERE clause: two taps on a slow connection are two
    // requests, and the second must not text the customer the same price again.
    const harness = buildHarness({ quote: { status: "sent", sent_at: new Date().toISOString() } });
    const response = await harness.send();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(harness.rest.rows("messages")).toHaveLength(0);
  });
});
