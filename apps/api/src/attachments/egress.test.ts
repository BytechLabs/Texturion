/**
 * #16 signed-URL egress metering helpers: the plan-derived allowance, the
 * period window, the fail-closed atomic claim wrapper, and the one gate every
 * mint path (the /url route AND the conversation gallery) calls before
 * signing (assertEgressWithinAllowance — page-level, per-bucket claims). The
 * /url route wiring is exercised end-to-end in routes/attachments.test.ts;
 * here the contract of each piece is pinned. Only global fetch (PostgREST) is
 * stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../http/errors";
import { supabaseStub, type SupabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { getDb } from "../db";
import {
  assertEgressWithinAllowance,
  claimSignedUrlEgress,
  companyPlanRow,
  EGRESS_ALLOWANCE_MULTIPLIER,
  egressAllowanceBytes,
  egressPeriodStart,
} from "./egress";

const env = completeEnv();
const GB = 1024 * 1024 * 1024;
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";

afterEach(() => vi.unstubAllGlobals());

describe("egressAllowanceBytes (#16)", () => {
  it("is the multiplier times the COMBINED effective storage budgets", async () => {
    // Starter base: 4 × (5 + 5) GB = 40 GB.
    expect(
      egressAllowanceBytes({ attachmentBytes: 5 * GB, mmsBytes: 5 * GB }),
    ).toBe(40 * GB);
    // Pro base: 4 × (25 + 25) GB = 200 GB.
    expect(
      egressAllowanceBytes({ attachmentBytes: 25 * GB, mmsBytes: 25 * GB }),
    ).toBe(200 * GB);
    // extra_storage grows each pool by 10 GB → the allowance grows 4×20 GB.
    expect(
      egressAllowanceBytes({ attachmentBytes: 15 * GB, mmsBytes: 15 * GB }),
    ).toBe((40 + 80) * GB);
    expect(EGRESS_ALLOWANCE_MULTIPLIER).toBe(4);
  });
});

describe("egressPeriodStart (#16)", () => {
  it("uses the live billing period when the company has one", () => {
    expect(egressPeriodStart("2026-06-15T00:00:00+00:00")).toBe(
      "2026-06-15T00:00:00+00:00",
    );
  });

  it("falls back to the current UTC calendar month pre-checkout (never an unbounded window)", () => {
    const now = new Date();
    expect(egressPeriodStart(null)).toBe(
      new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      ).toISOString(),
    );
  });
});

describe("claimSignedUrlEgress (#16, fail closed)", () => {
  function rpcRoute(
    respond: () => Response | Record<string, unknown>,
  ): { route: FetchRoute; bodies: unknown[] } {
    const bodies: unknown[] = [];
    const route: FetchRoute = (url, request) => {
      if (
        url.href.startsWith(
          `${env.SUPABASE_URL}/rest/v1/rpc/claim_signed_url_egress`,
        ) &&
        request.method === "POST"
      ) {
        return (async () => {
          bodies.push(await request.clone().json());
          const out = respond();
          return out instanceof Response ? out : Response.json(out);
        })();
      }
      return undefined;
    };
    return { route, bodies };
  }

  const args = {
    companyId: COMPANY_ID,
    since: "2026-07-01T00:00:00.000Z",
    bucket: "attachments",
    bytes: 2048,
    limitBytes: 40 * GB,
  };

  it("passes the claim through and returns the RPC verdict", async () => {
    const { route, bodies } = rpcRoute(() => ({
      allowed: true,
      used_bytes: 2048,
    }));
    stubFetch(route);

    const claim = await claimSignedUrlEgress(getDb(env), args);
    expect(claim).toEqual({ allowed: true, usedBytes: 2048 });
    expect(bodies[0]).toEqual({
      p_company_id: COMPANY_ID,
      p_since: "2026-07-01T00:00:00.000Z",
      p_bucket: "attachments",
      p_bytes: 2048,
      p_limit_bytes: 40 * GB,
    });
  });

  it("throws on an RPC error — the caller must not mint (fail closed)", async () => {
    const { route } = rpcRoute(
      () => new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
    );
    stubFetch(route);

    await expect(claimSignedUrlEgress(getDb(env), args)).rejects.toThrow(
      /claim_signed_url_egress failed/,
    );
  });

  it("throws on a malformed RPC result (garbage → no URL)", async () => {
    const { route } = rpcRoute(() => ({ nonsense: true }));
    stubFetch(route);

    await expect(claimSignedUrlEgress(getDb(env), args)).rejects.toThrow(
      /unexpected shape/,
    );
  });
});

describe("companyPlanRow (#16 / D30 anchor)", () => {
  it("defaults a plan-null (pre-checkout) company to the Starter posture", async () => {
    const sb = supabaseStub(env);
    sb.on("GET", "/rest/v1/companies", () => [
      { plan: null, current_period_start: null },
    ]);
    stubFetch(sb.route);

    expect(await companyPlanRow(getDb(env), COMPANY_ID)).toEqual({
      plan: "starter",
      currentPeriodStart: null,
    });
  });

  it("returns the live plan + billing-period anchor, scoped to the live company row", async () => {
    const sb = supabaseStub(env);
    sb.on("GET", "/rest/v1/companies", () => [
      { plan: "pro", current_period_start: "2026-07-01T00:00:00+00:00" },
    ]);
    stubFetch(sb.route);

    expect(await companyPlanRow(getDb(env), COMPANY_ID)).toEqual({
      plan: "pro",
      currentPeriodStart: "2026-07-01T00:00:00+00:00",
    });
    const lookup = sb.find("GET", "/rest/v1/companies")[0];
    expect(lookup.url.searchParams.get("id")).toBe(`eq.${COMPANY_ID}`);
    expect(lookup.url.searchParams.get("deleted_at")).toBe("is.null");
  });
});

describe("assertEgressWithinAllowance (#16 — the gate every mint path calls)", () => {
  const PERIOD_START = "2026-07-01T00:00:00+00:00";
  /** Starter allowance: 4 × (5 GB attachments + 5 GB MMS) = 40 GB. */
  const STARTER_ALLOWANCE = 40 * GB;

  /**
   * The full resolution chain (company plan → company_modules → claim RPC),
   * with the RPC mimicking the SQL: usedBytes + p_bytes vs p_limit_bytes.
   */
  function poolStub(options: { usedBytes?: number } = {}): SupabaseStub {
    const sb = supabaseStub(env);
    sb.on("GET", "/rest/v1/companies", () => [
      { plan: "starter", current_period_start: PERIOD_START },
    ]);
    // extra_storage off → base plan budgets.
    sb.on("GET", "/rest/v1/company_modules", () => []);
    sb.on("POST", "/rest/v1/rpc/claim_signed_url_egress", (call) => {
      const p = call.body as { p_bytes: number; p_limit_bytes: number };
      const used = options.usedBytes ?? 0;
      if (used + p.p_bytes > p.p_limit_bytes) {
        return { allowed: false, used_bytes: used };
      }
      return { allowed: true, used_bytes: used + p.p_bytes };
    });
    return sb;
  }

  it("claims ONE per-bucket subtotal for a mixed page (NULL sizes claim 0), resolving the allowance once", async () => {
    const sb = poolStub();
    stubFetch(sb.route);

    await assertEgressWithinAllowance(getDb(env), COMPANY_ID, [
      { bucket: "attachments", sizeBytes: 2048 },
      { bucket: "mms-media", sizeBytes: null }, // legacy NULL size → 0
      { bucket: "attachments", sizeBytes: 1024 },
      { bucket: "mms-media", sizeBytes: 4096 },
    ]);

    // Exactly one claim per bucket, carrying that bucket's summed bytes,
    // against the shared pool + period window.
    const claims = sb.find("POST", "/rest/v1/rpc/claim_signed_url_egress");
    expect(claims.map((call) => call.body)).toEqual([
      {
        p_company_id: COMPANY_ID,
        p_since: PERIOD_START,
        p_bucket: "attachments",
        p_bytes: 3072,
        p_limit_bytes: STARTER_ALLOWANCE,
      },
      {
        p_company_id: COMPANY_ID,
        p_since: PERIOD_START,
        p_bucket: "mms-media",
        p_bytes: 4096,
        p_limit_bytes: STARTER_ALLOWANCE,
      },
    ]);
    // The plan + module resolution ran ONCE for the whole page — a gallery
    // page costs the same round trips as a single /url mint.
    expect(sb.find("GET", "/rest/v1/companies")).toHaveLength(1);
    expect(sb.find("GET", "/rest/v1/company_modules")).toHaveLength(1);
  });

  it("does nothing at all for an empty page (no reads, no claims)", async () => {
    const sb = poolStub();
    stubFetch(sb.route);

    await assertEgressWithinAllowance(getDb(env), COMPANY_ID, []);
    expect(sb.calls).toHaveLength(0);
  });

  it("throws usage_cap_reached over the allowance and stops claiming (cap-and-drop)", async () => {
    // Pool already fully spent → the FIRST bucket's claim is refused.
    const sb = poolStub({ usedBytes: STARTER_ALLOWANCE });
    stubFetch(sb.route);

    let error: unknown;
    try {
      await assertEgressWithinAllowance(getDb(env), COMPANY_ID, [
        { bucket: "attachments", sizeBytes: 1 },
        { bucket: "mms-media", sizeBytes: 1 },
      ]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("usage_cap_reached");
    expect((error as ApiError).message).toContain("40 GB");
    // The refusal short-circuits: the second bucket is never claimed.
    expect(sb.find("POST", "/rest/v1/rpc/claim_signed_url_egress")).toHaveLength(1);
  });

  it("propagates a claim error — the caller must not sign (fail closed)", async () => {
    // Not poolStub(): its healthy RPC responder would win (registration order).
    const sb = supabaseStub(env);
    sb.on("GET", "/rest/v1/companies", () => [
      { plan: "starter", current_period_start: PERIOD_START },
    ]);
    sb.on("GET", "/rest/v1/company_modules", () => []);
    sb.on(
      "POST",
      "/rest/v1/rpc/claim_signed_url_egress",
      () => new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
    );
    stubFetch(sb.route);

    await expect(
      assertEgressWithinAllowance(getDb(env), COMPANY_ID, [
        { bucket: "attachments", sizeBytes: 64 },
      ]),
    ).rejects.toThrow(/claim_signed_url_egress failed/);
  });
});
