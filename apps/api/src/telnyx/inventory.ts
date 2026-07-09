import type { Env } from "../env";

import { telnyxRequest, TelnyxApiError } from "./client";

/**
 * Telnyx available-number inventory search for the customer-facing number
 * PICKER — it returns a LIST of orderable numbers, distinct from provisioning's
 * private `searchAvailableNumber` (which returns exactly one number to
 * auto-order and lives inside the buy saga). A dry filter combination (an
 * exhausted area code) is Telnyx's 400 code 10031, not an empty 200 — we catch
 * it and return an empty list with `best_effort_exhausted`, never a 5xx.
 */

/** Telnyx's available-number shape — only the fields the picker needs. */
interface TelnyxAvailableNumber {
  phone_number?: string;
  region_information?: { region_type?: string; region_name?: string }[];
  features?: ({ name?: string } | string)[];
}
interface TelnyxAvailableResponse {
  data?: TelnyxAvailableNumber[];
}

/** A sanitized available number for the picker — no cost/vendor internals. */
export interface AvailableNumber {
  /** E.164. */
  phone_number: string;
  /** A human region label (locality or state/province), when Telnyx provides one. */
  region: string | null;
  /** Capability names, e.g. ["sms","mms","voice"]. */
  features: string[];
}

export interface InventoryResult {
  data: AvailableNumber[];
  /** True when the exact filters matched nothing (exhausted) — the UI prompts to widen. */
  best_effort_exhausted: boolean;
}

function regionLabel(n: TelnyxAvailableNumber): string | null {
  const infos = n.region_information ?? [];
  const locality = infos.find(
    (r) => r.region_type === "locality" || r.region_type === "rate_center",
  )?.region_name;
  const admin = infos.find(
    (r) => r.region_type === "state" || r.region_type === "province",
  )?.region_name;
  return locality ?? admin ?? infos[0]?.region_name ?? null;
}

function featureNames(n: TelnyxAvailableNumber): string[] {
  return (n.features ?? [])
    .map((f) => (typeof f === "string" ? f : f?.name))
    .filter((f): f is string => typeof f === "string");
}

export async function searchInventory(
  env: Env,
  opts: {
    country: string;
    areaCode?: string;
    bestEffort?: boolean;
    limit?: number;
  },
): Promise<InventoryResult> {
  const query: Record<string, string> = {
    "filter[country_code]": opts.country,
    "filter[phone_number_type]": "local",
    "filter[features]": "sms",
    "filter[limit]": String(opts.limit ?? 20),
  };
  if (opts.areaCode) query["filter[national_destination_code]"] = opts.areaCode;
  // best_effort widens the search to nearby numbers when the exact area code is
  // dry — an explicit, user-triggered "show nearby numbers", never automatic.
  if (opts.bestEffort) query["filter[best_effort]"] = "true";

  try {
    const res = await telnyxRequest<TelnyxAvailableResponse>(env, {
      method: "GET",
      path: "/v2/available_phone_numbers",
      query,
    });
    const data = (res.data ?? [])
      .filter(
        (n): n is TelnyxAvailableNumber & { phone_number: string } =>
          typeof n.phone_number === "string",
      )
      .map((n) => ({
        phone_number: n.phone_number,
        region: regionLabel(n),
        features: featureNames(n),
      }));
    return { data, best_effort_exhausted: false };
  } catch (error) {
    if (error instanceof TelnyxApiError && error.hasCode("10031")) {
      return { data: [], best_effort_exhausted: true };
    }
    throw error;
  }
}
