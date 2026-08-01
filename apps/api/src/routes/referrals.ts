import { REFERRAL_REWARDS_PER_YEAR, referralStage } from "@loonext/shared";
import { Hono } from "hono";

import { requireCapability } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { ensureReferralCode } from "../referrals/referrals";

/**
 * #399 — GET /v1/referrals: this workspace's link, and what it has done.
 *
 * THE PRODUCT HANDS OVER A LINK AND NOTHING ELSE. There is deliberately no
 * "send this to your contacts" here and there never will be — #399 is explicit
 * that such a flow would be the mass-texting D4 and D11 exclude, turning a
 * crew's consented customer list into an acquisition funnel. Where the link goes
 * is the owner's business.
 *
 * BEHIND `billing.manage`, which is what makes it owner/admin/bookkeeper rather
 * than every member. The reward is a month off the invoice, so this is a money
 * screen, and it belongs to whoever the money belongs to.
 */
export const referralRoutes = new Hono<AppEnv>();

referralRoutes.use("*", requireCapability("billing.manage"));

interface ReferralRow {
  id: string;
  created_at: string;
  qualified_at: string | null;
  rewarded_at: string | null;
  voided_at: string | null;
}

referralRoutes.get("/", async (c) => {
  const env = getEnv(c.env);
  const db = getDb(env);
  const companyId = c.get("companyId");

  // Minting on read rather than at signup: most workspaces never open this
  // screen, and a code for everybody is a column to backfill and keep unique
  // for no reason.
  const code = await ensureReferralCode(db, companyId);

  const { data, error } = await db.rpc("referrals_for_company", {
    p_company_id: companyId,
  });
  if (error) throw new Error(`referrals_for_company failed: ${error.message}`);
  const rows = (data ?? []) as ReferralRow[];

  const now = new Date();
  const referrals = rows.map((row) => ({
    id: row.id,
    created_at: row.created_at,
    // The four states #399 asks for: invited, signed up, still active at 30
    // days, rewarded. Computed by the shared function so this screen and any
    // other agree about what "active" means.
    stage: row.voided_at
      ? ("voided" as const)
      : referralStage(
          {
            createdAt: row.created_at,
            qualifiedAt: row.qualified_at,
            rewardedAt: row.rewarded_at,
          },
          now,
        ),
  }));

  const rewardedThisYear = rows.filter(
    (row) =>
      row.rewarded_at !== null &&
      now.getTime() - Date.parse(row.rewarded_at) < 365 * 24 * 60 * 60 * 1000,
  ).length;

  return c.json({
    code,
    // The whole link, assembled server-side. A client that builds it from a
    // hardcoded origin is a client that gets it wrong on one surface.
    //
    // SITE_ORIGIN is optional in the schema, so it is checked rather than
    // interpolated: `undefined/?ref=ABCD` is a link somebody would copy, paste
    // and wonder about. Null lets the screen show the code alone, which is
    // still usable, instead of a broken URL that looks authoritative.
    link: env.SITE_ORIGIN ? `${env.SITE_ORIGIN}/?ref=${code}` : null,
    referrals,
    rewarded_this_year: rewardedThisYear,
    // Stated rather than implied. A cap somebody discovers by hitting it reads
    // as a bug; a cap on the screen reads as a rule.
    reward_cap_per_year: REFERRAL_REWARDS_PER_YEAR,
  });
});
