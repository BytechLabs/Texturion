/**
 * #331 — reading Telnyx's opt-out list.
 *
 * Telnyx keeps its own list, per messaging profile, populated by the keyword
 * blocking it does at the carrier edge. It is READ ONLY to us: there is no
 * write API, which is exactly why SPEC §5 says manual opt-outs are enforced
 * app-side. So this cannot push and does not try. It reads, so the daily
 * reconciliation can compare.
 *
 * WHAT `from` AND `to` MEAN HERE, because it is the opposite of what a reader
 * expects. An opt-out record describes the MESSAGE that carried the STOP: it
 * came FROM the customer TO our business number. So `from` is the customer who
 * opted out — the number we must stop texting — and `to` is ours. Getting this
 * backwards would opt out the business's own number, which is why it is
 * spelled out here and asserted in the tests.
 */
import { telnyxRequest } from "./client";
import type { Env } from "../env";

/** One entry on the carrier's list, in the terms the rest of the code uses. */
export interface CarrierOptOut {
  /** The customer number that opted out. */
  phoneE164: string;
  /** Our number they opted out FROM. */
  ourNumberE164: string | null;
  /** The keyword the carrier matched, when it says. */
  keyword: string | null;
  /** When the carrier recorded it, ISO, when it says. */
  createdAt: string | null;
}

interface TelnyxOptOutItem {
  from?: unknown;
  to?: unknown;
  keyword?: unknown;
  created_at?: unknown;
}

/** Telnyx's page size ceiling for this collection. */
const PAGE_SIZE = 250;

/**
 * A hard stop on how much of one profile's list we will walk in a single run.
 * The reconciliation is a nightly report, not a migration: a profile with more
 * opt-outs than this has a bigger problem than a slow report, and an unbounded
 * loop against a paginated vendor endpoint is how a cron turns into an outage.
 * Truncation is REPORTED rather than silent — a report that quietly stopped
 * reading is worse than no report.
 */
const MAX_PAGES = 20;

export interface CarrierOptOutPage {
  optOuts: CarrierOptOut[];
  /** True when the list was longer than {@link MAX_PAGES} allows. */
  truncated: boolean;
}

/**
 * Every opt-out Telnyx holds for one messaging profile.
 *
 * Throws {@link import("./client").TelnyxApiError} like every other call here;
 * the caller decides whether one profile's failure stops the sweep (it does
 * not — see the reconciliation job).
 */
export async function listCarrierOptOuts(
  env: Env,
  messagingProfileId: string,
): Promise<CarrierOptOutPage> {
  const optOuts: CarrierOptOut[] = [];
  let page = 1;

  for (; page <= MAX_PAGES; page += 1) {
    const body = await telnyxRequest<{ data?: TelnyxOptOutItem[] }>(env, {
      method: "GET",
      path: "/v2/messaging_optouts",
      query: {
        "filter[messaging_profile_id]": messagingProfileId,
        "page[number]": String(page),
        "page[size]": String(PAGE_SIZE),
      },
    });

    const items = Array.isArray(body?.data) ? body.data : [];
    for (const item of items) {
      // `from` is the customer. Anything without one is not usable as an
      // opt-out record, and guessing which field meant what is how a bad parse
      // ends up blocking the wrong number.
      const phone = typeof item.from === "string" ? item.from.trim() : "";
      if (!phone) continue;
      optOuts.push({
        phoneE164: phone,
        ourNumberE164: typeof item.to === "string" ? item.to : null,
        keyword: typeof item.keyword === "string" ? item.keyword : null,
        createdAt: typeof item.created_at === "string" ? item.created_at : null,
      });
    }

    // A short page is the last page.
    if (items.length < PAGE_SIZE) return { optOuts, truncated: false };
  }

  return { optOuts, truncated: true };
}
