/**
 * GET /v1/me (SPEC §7) — profile + memberships. One of the three
 * company-exempt routes: it carries a JWT but no required X-Company-Id.
 * When the client DOES send X-Company-Id (the dashboard shell does, to
 * hydrate the active workspace in one round trip), the response additionally
 * embeds that company's subscription status, plan, registration snapshot,
 * and number list — after validating the caller's active membership, exactly
 * as the company-context middleware would.
 */
import { Hono } from "hono";
import { z } from "zod";

import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { loadCompanyView } from "./core/company-view";
import { unwrap } from "./core/http";

const companyIdSchema = z.uuid();

interface MembershipRow {
  company_id: string;
  role: string;
  companies: { name: string; subscription_status: string };
}

export const meRoutes = new Hono<AppEnv>();

meRoutes.get("/me", async (c) => {
  const db = getDb(getEnv(c.env));
  const userId = c.get("userId");

  const profiles = unwrap<{ display_name: string }[]>(
    await db
      .from("profiles")
      .select("display_name")
      .eq("user_id", userId)
      .limit(1),
    "profile lookup",
  );

  const membershipRows = unwrap<MembershipRow[]>(
    await db
      .from("company_members")
      .select(
        "company_id,role,companies!inner(name,subscription_status,deleted_at)",
      )
      .eq("user_id", userId)
      .is("deactivated_at", null)
      .is("companies.deleted_at", null),
    "memberships lookup",
  );

  const memberships = membershipRows.map((row) => ({
    company_id: row.company_id,
    name: row.companies.name,
    role: row.role,
    subscription_status: row.companies.subscription_status,
  }));

  const body: Record<string, unknown> = {
    user_id: userId,
    display_name: profiles[0]?.display_name ?? "",
    memberships,
  };

  // Optional hydration for the X-Company-Id workspace. The route is exempt
  // from the company-context middleware, so the membership check happens here
  // with the same rule: active membership for the verified sub, else 403.
  const header = c.req.header("X-Company-Id");
  if (header !== undefined) {
    const parsed = companyIdSchema.safeParse(header);
    if (!parsed.success) {
      return errorResponse(
        c,
        "validation_failed",
        "X-Company-Id header must be a UUID.",
      );
    }
    const membership = memberships.find((m) => m.company_id === parsed.data);
    if (!membership) {
      return errorResponse(
        c,
        "forbidden",
        "Not an active member of this company.",
      );
    }
    const company = await loadCompanyView(db, parsed.data);
    if (!company) {
      return errorResponse(c, "not_found", "No such company.");
    }
    body.company = company;
  }

  return c.json(body);
});
