/**
 * #379/#426: a workspace's delivery rate per destination country, shown to
 * the customer on the usage page.
 *
 * US and Canadian numbers are both +1, so the country lives in the area code,
 * and the area-code table is `NANP_AREA_CODES` in `shared`. One table, read
 * from TypeScript, rather than a second copy of it in a migration.
 *
 * The fleet-wide split is PostHog's: every final status sends a
 * `message_outcome` event with its country (D146).
 */
import { lookupAreaCode, type NanpCountry } from "@loonext/shared";

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
  /** #426: accepted by us but not yet acknowledged by a carrier. */
  pending: number;
  /**
   * delivered / (delivered + failed).
   *
   * NULL below {@link DELIVERY_MIN_SAMPLE}, and that is a product decision
   * rather than a rounding one: a shop sending forty texts a week sees one
   * failure as 2.5%, which looks alarming and almost always means a
   * disconnected number. A percentage over a tiny sample manufactures exactly
   * the anxiety this figure exists to remove, so below the line the clients
   * are handed counts and no rate to render.
   */
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
      pending: 0,
      rate: null,
    };
    bucket.sent += 1;
    if (row.status === "delivered") bucket.delivered += 1;
    if (row.status === "failed") bucket.failed += 1;
    if (row.status === "queued" || row.status === "sent") bucket.pending += 1;
    buckets.set(country, bucket);
  }

  return [...buckets.values()]
    .map((b) => {
      const settled = b.delivered + b.failed;
      return {
        ...b,
        rate: settled >= DELIVERY_MIN_SAMPLE ? b.delivered / settled : null,
      };
    })
    .sort((a, b) => a.country.localeCompare(b.country));
}
