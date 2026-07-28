/**
 * #379 ask 4 — delivery rate per destination country.
 *
 * D2 says Canada-bound outbound needs no registration, and the code agrees with
 * a hardcoded `caAllowed: true`. That reading may still be right. What makes it
 * dangerous is the SHAPE of being wrong: a Canadian carrier filtering
 * unregistered A2P traffic does not return an error. The message is accepted,
 * billed, marked sent, and never arrives.
 *
 * So there is no failure to catch — only an absence, which per #387 is the one
 * thing this product cannot see. Delivery rate split by DESTINATION COUNTRY is
 * the only signal that would ever tell us, and it is worth having whether or
 * not D2 turns out to be correct. That is why this ships ahead of the answer
 * rather than behind it.
 *
 * WHY THE COUNTRY IS DERIVED HERE RATHER THAN IN SQL: US and Canadian numbers
 * are both +1, so the country lives in the area code, and the area-code table
 * is `NANP_AREA_CODES` in `shared`. Copying ~800 area codes into a migration to
 * do this in Postgres would be a second copy of a table with nothing keeping it
 * in step — the exact drift that has bitten this repo twice this week. One
 * table, read from TypeScript.
 */
import { lookupAreaCode, type NanpCountry } from "@loonext/shared";

import { getDb } from "../db";
import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";

/** How far back each run looks. */
export const DELIVERY_WINDOW_DAYS = 7;

/**
 * Below this delivery rate a destination country is worth a human look.
 *
 * Deliberately low. Carriers drop a small share of traffic for ordinary
 * reasons — handsets off, numbers reassigned — and an alert that fires on
 * normal noise gets filtered by the person receiving it, which is the failure
 * mode this whole alert exists to avoid.
 */
export const DELIVERY_ALERT_FLOOR = 0.85;

/**
 * Minimum messages to a country before its rate means anything. Three sends
 * and one failure is 67%, and says nothing at all.
 */
export const DELIVERY_MIN_SAMPLE = 50;

export interface CountryDelivery {
  country: NanpCountry | "other";
  sent: number;
  delivered: number;
  failed: number;
  /** delivered / (delivered + failed), or null when nothing has settled. */
  rate: number | null;
}

interface OutboundRow {
  status: string;
  conversations: { contacts: { phone_e164: string } | null } | null;
}

/** Bucket settled outbound messages by the destination's country. Pure. */
export function summarize(rows: OutboundRow[]): CountryDelivery[] {
  const buckets = new Map<string, CountryDelivery>();
  for (const row of rows) {
    const phone = row.conversations?.contacts?.phone_e164;
    if (!phone) continue;
    const entry = lookupAreaCode(phone);
    // A NANP area code we do not recognise is "other" rather than dropped:
    // the Caribbean shares +1 and bills at international rates, so a surprise
    // there is worth seeing, not hiding.
    const country: NanpCountry | "other" = entry?.country ?? "other";

    const bucket = buckets.get(country) ?? {
      country,
      sent: 0,
      delivered: 0,
      failed: 0,
      rate: null,
    };
    bucket.sent += 1;
    if (row.status === "delivered") bucket.delivered += 1;
    if (row.status === "failed") bucket.failed += 1;
    buckets.set(country, bucket);
  }

  return [...buckets.values()]
    .map((b) => {
      const settled = b.delivered + b.failed;
      return { ...b, rate: settled > 0 ? b.delivered / settled : null };
    })
    .sort((a, b) => a.country.localeCompare(b.country));
}

/** Countries whose rate is both meaningful and bad. */
export function underperforming(rows: CountryDelivery[]): CountryDelivery[] {
  return rows.filter(
    (r) =>
      r.delivered + r.failed >= DELIVERY_MIN_SAMPLE &&
      r.rate !== null &&
      r.rate < DELIVERY_ALERT_FLOOR,
  );
}

/**
 * Daily check: is anything we send failing to land in one country and not
 * another? Ops-only — this is our signal about carriers, not the customer's
 * problem to act on, and a customer told "your texts may not be arriving in
 * Canada" can do precisely nothing with that.
 */
export async function runDeliveryByCountryJob(
  env: Env,
  now: Date = new Date(),
): Promise<void> {
  const db = getDb(env);
  const since = new Date(
    now.getTime() - DELIVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await db
    .from("messages")
    .select("status,conversations(contacts(phone_e164))")
    .eq("direction", "outbound")
    .in("status", ["delivered", "failed"])
    .gte("created_at", since)
    .limit(5000);
  if (error) {
    throw new Error(`delivery-by-country read failed: ${error.message}`);
  }

  const summary = summarize((data ?? []) as unknown as OutboundRow[]);
  const bad = underperforming(summary);
  if (bad.length === 0) return;

  const lines = summary
    .map(
      (r) =>
        `  ${r.country}: ${r.delivered} delivered, ${r.failed} failed` +
        (r.rate === null ? "" : ` (${(r.rate * 100).toFixed(1)}%)`),
    )
    .join("\n");

  const text =
    `Delivery rate fell below ${(DELIVERY_ALERT_FLOOR * 100).toFixed(0)}% in ` +
    `${bad.map((b) => b.country).join(", ")} over the last ` +
    `${DELIVERY_WINDOW_DAYS} days.\n\n${lines}\n\n` +
    `A carrier filtering unregistered A2P traffic does not return an error — ` +
    `the message is accepted, billed, marked sent, and never arrives. This ` +
    `split is the only signal that would ever show it (#379, #235).\n\n` +
    `If CANADA is the country below the line, the open question in DECISIONS ` +
    `D2 is the first place to look: every number we hold was bought after the ` +
    `2025-03-26 cutoff, so none of them is grandfathered for domestic ` +
    `Canadian traffic, and none carries a messaging campaign.`;

  await sendEmail(env, {
    to: [env.OPS_ALERT_EMAIL ?? "support@loonext.com"],
    subject: `[ops] delivery rate low in ${bad.map((b) => b.country).join(", ")}`,
    text,
    html: renderEmailHtml(text),
  });
}
