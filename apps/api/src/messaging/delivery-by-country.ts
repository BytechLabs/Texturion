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
import { lookupAreaCode, NANP_AREA_CODES } from '@loonext/shared';
import type { NanpCountry } from '@loonext/shared';

/**
 * Minimum messages to a country before its rate means anything. Three sends
 * and one failure is 67%, and says nothing at all.
 */
export const DELIVERY_MIN_SAMPLE = 50;

/**
 * A NANP area code we do not recognise is "other" rather than dropped: the
 * Caribbean shares +1 and bills at international rates, so a surprise there is
 * worth seeing, not hiding.
 */
export function phoneCountry(phone: string | null | undefined): NanpCountry | "other" {
  return (phone ? lookupAreaCode(phone)?.country : undefined) ?? "other";
}

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

interface DeliveryAreaTotals {
  area_code: string | null;
  sent: number;
  delivered: number;
  failed: number;
  pending: number;
}

/** Combine area-code totals into country totals before calculating rates. */
export function summarize(rows: DeliveryAreaTotals[]): CountryDelivery[] {
  const buckets = new Map<string, CountryDelivery>();
  for (const row of rows) {
    const country = NANP_AREA_CODES[row.area_code ?? ""]?.country ?? "other";

    const bucket = buckets.get(country) ?? {
      country,
      sent: 0,
      delivered: 0,
      failed: 0,
      pending: 0,
      rate: null,
    };
    bucket.sent += row.sent;
    bucket.delivered += row.delivered;
    bucket.failed += row.failed;
    bucket.pending += row.pending;
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
    .toSorted((a, b) => a.country.localeCompare(b.country));
}
