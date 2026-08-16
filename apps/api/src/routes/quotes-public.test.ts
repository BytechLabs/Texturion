/**
 * #287 — the routes a homeowner reaches, which sit outside every gate that
 * protects `/v1`.
 *
 * The cases here are the ones where a plausible implementation leaks or binds
 * somebody to a price: a view token that can also accept, an accept that
 * honours a lapsed offer because the stored column still says `sent`, a
 * double tap that overwrites the first acceptance, and a failure page that
 * tells the holder which kind of failure it was.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { Hono } from "hono";

import type { AppEnv } from "../context";
import { supabaseStub, type SupabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import { publicQuoteRoutes } from "./quotes-public";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const QUOTE_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
/** 43 characters of the token alphabet — the shape `resolvePublicLink` demands. */
const TOKEN = "a".repeat(43);

const DAY = 24 * 60 * 60 * 1000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();

/*
 * Mounted at the ROOT, exactly as index.ts does. buildTestApp puts everything
 * under /v1 behind auth, and testing these at a path production does not serve
 * would be a suite that passes while the real routes 404.
 */
const app = new Hono<AppEnv>();
app.route("/", publicQuoteRoutes);

const call = (path: string, init: RequestInit = {}) =>
  app.request(path, init, env as unknown as Record<string, unknown>);

afterEach(() => {
  vi.unstubAllGlobals();
});

const quote = (over: Record<string, unknown> = {}) => ({
  id: QUOTE_ID,
  amount_cents: 45_000,
  currency: "cad",
  description: "Replace the water heater",
  status: "sent",
  expires_at: inDays(7),
  viewed_at: null,
  decided_at: null,
  ...over,
});

/** A stub whose resolve answers `ok` for one purpose and refuses every other. */
function stubResolving(purpose: string, over: Record<string, unknown> = {}): SupabaseStub {
  const sb = supabaseStub(env);
  sb.on("POST", "/rest/v1/rpc/api_resolve_public_link", (req) => {
    const body = req.body as { p_purpose: string };
    if (body.p_purpose !== purpose) return { ok: false, outcome: "wrong_purpose" };
    return {
      ok: true,
      outcome: "ok",
      link_id: "11111111-2222-4333-8444-555555555555",
      company_id: COMPANY_ID,
      subject_type: "quote",
      subject_id: QUOTE_ID,
      ...over,
    };
  });
  sb.on("GET", "/rest/v1/companies", () => [{ name: "Apex Plumbing" }]);
  return sb;
}

describe("GET /q/:token", () => {
  it("shows the business, the amount and the work, and nothing about the customer", async () => {
    // The disclosure rule the payment and photo pages already follow. This URL
    // lives in SMS logs and browser history; the customer's own name, address
    // and number are things they already know and we must not re-publish.
    const sb = stubResolving("quote_view");
    sb.on("GET", "/rest/v1/quotes", () => [quote()]);
    stubFetch(sb.route);

    const res = await call(`/q/${TOKEN}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.business_name).toBe("Apex Plumbing");
    expect(body.amount_cents).toBe(45_000);
    expect(body.can_accept).toBe(true);
    // Nothing that identifies the person holding the link.
    expect(Object.keys(body)).not.toContain("contact_id");
    expect(Object.keys(body)).not.toContain("conversation_id");
  });

  it("reads a lapsed quote as expired even though the row says sent", async () => {
    // Nothing writes `expired`. A page that trusted the column would invite
    // somebody to accept a price the business withdrew last week.
    const sb = stubResolving("quote_view");
    sb.on("GET", "/rest/v1/quotes", () => [quote({ expires_at: inDays(-1) })]);
    stubFetch(sb.route);

    const res = await call(`/q/${TOKEN}`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("expired");
    expect(body.can_accept).toBe(false);
  });

  it("stamps the first view once, and never over a decision", async () => {
    const sb = stubResolving("quote_view");
    sb.on("GET", "/rest/v1/quotes", () => [quote()]);
    sb.on("PATCH", "/rest/v1/quotes", () => []);
    stubFetch(sb.route);

    await call(`/q/${TOKEN}`);
    const writes = sb.find("PATCH", "/rest/v1/quotes");
    expect(writes).toHaveLength(1);
    // Guarded on `status = sent` in the query, so a quote answered between the
    // read and the write is not walked backwards over.
    expect(writes[0].url.searchParams.get("status")).toBe("eq.sent");
  });

  it("does not restamp a quote already viewed", async () => {
    // The useful fact is when they FIRST looked. Overwriting it loses the
    // difference between chasing and waiting.
    const sb = stubResolving("quote_view");
    sb.on("GET", "/rest/v1/quotes", () => [
      quote({ status: "viewed", viewed_at: inDays(-1) }),
    ]);
    stubFetch(sb.route);

    await call(`/q/${TOKEN}`);
    expect(sb.find("PATCH", "/rest/v1/quotes")).toHaveLength(0);
  });

  it("answers a bad token the same way as a missing quote", async () => {
    // No oracle. A holder who can tell "expired" from "never existed" can
    // enumerate the difference.
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_resolve_public_link", () => ({
      ok: false,
      outcome: "expired",
    }));
    stubFetch(sb.route);
    const expired = await call(`/q/${TOKEN}`);

    const sb2 = stubResolving("quote_view");
    sb2.on("GET", "/rest/v1/quotes", () => []);
    stubFetch(sb2.route);
    const missing = await call(`/q/${TOKEN}`);

    expect(expired.status).toBe(missing.status);
    expect(await expired.text()).toBe(await missing.text());
  });
});

describe("POST /q/:token/accept", () => {
  it("refuses a VIEW token, which is the whole reason purpose is stored", async () => {
    /*
     * The property that makes a link safe to text: the URL the customer opens
     * cannot commit them. A forwarded link, or one scraped from an SMS log,
     * views and nothing more.
     */
    const sb = stubResolving("quote_view"); // accept is NOT this purpose
    sb.on("GET", "/rest/v1/quotes", () => [quote()]);
    stubFetch(sb.route);

    const res = await call(`/q/${TOKEN}/accept`, { method: "POST" });
    expect(res.status).toBe(404);
    expect(sb.find("PATCH", "/rest/v1/quotes")).toHaveLength(0);
  });

  it("accepts a live quote and kills both links", async () => {
    const sb = stubResolving("quote_accept");
    sb.on("GET", "/rest/v1/quotes", () => [quote()]);
    sb.on("PATCH", "/rest/v1/quotes", () => [{ id: QUOTE_ID }]);
    sb.on("POST", "/rest/v1/rpc/api_revoke_public_links_for_subject", () => 2);
    stubFetch(sb.route);

    const res = await call(`/q/${TOKEN}/accept`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: true, status: "accepted" });

    const revoke = sb.find("POST", "/rest/v1/rpc/api_revoke_public_links_for_subject")[0];
    // #571: the company id is required and first. Without it this revoked any
    // workspace's live link from a subject uuid alone.
    expect((revoke.body as { p_company_id: string }).p_company_id).toBe(COMPANY_ID);
  });

  it("refuses to bind anybody to a price that has lapsed", async () => {
    // The row still says `sent`. Checking the stored column here would accept
    // an offer the business withdrew.
    const sb = stubResolving("quote_accept");
    sb.on("GET", "/rest/v1/quotes", () => [quote({ expires_at: inDays(-1) })]);
    stubFetch(sb.route);

    const res = await call(`/q/${TOKEN}/accept`, { method: "POST" });
    expect(res.status).toBe(409);
    expect(sb.find("PATCH", "/rest/v1/quotes")).toHaveLength(0);
  });

  it("treats a lost double-tap race as accepted rather than as an error", async () => {
    /*
     * Two taps on a slow connection are two requests. The guard is in the
     * WHERE clause, so the second update matches nothing — and from the
     * customer's side the quote IS accepted, so telling them it failed would
     * be both wrong and alarming.
     */
    const sb = stubResolving("quote_accept");
    sb.on("GET", "/rest/v1/quotes", () => [quote()]);
    sb.on("PATCH", "/rest/v1/quotes", () => []);
    stubFetch(sb.route);

    const res = await call(`/q/${TOKEN}/accept`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: true, status: "accepted" });
  });

  it("guards the write on the answerable statuses", async () => {
    const sb = stubResolving("quote_accept");
    sb.on("GET", "/rest/v1/quotes", () => [quote()]);
    sb.on("PATCH", "/rest/v1/quotes", () => [{ id: QUOTE_ID }]);
    sb.on("POST", "/rest/v1/rpc/api_revoke_public_links_for_subject", () => 2);
    stubFetch(sb.route);

    await call(`/q/${TOKEN}/accept`, { method: "POST" });
    const write = sb.find("PATCH", "/rest/v1/quotes")[0];
    expect(write.url.searchParams.get("status")).toBe("in.(sent,viewed)");
    expect(write.url.searchParams.get("company_id")).toBe(`eq.${COMPANY_ID}`);
  });
});
