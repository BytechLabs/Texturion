/**
 * #232 phase 3 — which of the workspace's numbers the widget lands on.
 *
 * # Why this is one function and not two lookups
 *
 * The widget resolves a number TWICE in a submission: once to send the
 * verification code from, and again — in a separate request, minutes later — to
 * thread the message onto. Those two answers have to be the same number, or the
 * visitor proves their phone against one line and the crew's reply arrives from
 * another. To the visitor that reads as a stranger texting them.
 *
 * While both call sites independently said "oldest active", they agreed by
 * accident. The moment a workspace can CHOOSE, two copies of the rule are two
 * chances for one of them to drift — and the drift is silent, because each half
 * works perfectly on its own.
 *
 * # The fallback is the whole design
 *
 * `widget_number_id` is nullable and means "we have not been told". A workspace
 * with one number is never asked, and a workspace that has not chosen keeps
 * exactly the behaviour they had before this existed.
 *
 * It also has to survive its own answer going away. A chosen number can be
 * released, suspended for non-payment, or ported out, and none of those events
 * knows the widget exists. Refusing the submission then would take a paid-for
 * conversion offline over a setting nobody remembers making, so a choice that
 * no longer resolves falls back to the same default — the visitor gets through,
 * and the settings card is where the stale choice gets noticed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** The line a widget conversation uses, or null when the workspace has none. */
export interface WidgetNumber {
  id: string;
  number_e164: string;
}

/**
 * Resolve the widget's line for a workspace.
 *
 * Returns null when there is no active number at all — a workspace mid-signup,
 * or one whose number was released. The caller answers the visitor with the
 * same "unavailable" it uses for an unknown key: a stranger on somebody else's
 * website learns nothing about why.
 */
export async function resolveWidgetNumber(
  db: SupabaseClient,
  companyId: string,
): Promise<WidgetNumber | null> {
  const { data: company, error: companyError } = await db
    .from("companies")
    .select("widget_number_id")
    .eq("id", companyId)
    .maybeSingle();
  if (companyError) {
    throw new Error(`widget number setting lookup failed: ${companyError.message}`);
  }

  // Every ACTIVE number, oldest first — the default is the workspace's first
  // number, which is the one on their van and their invoices.
  const { data: numbers, error: numberError } = await db
    .from("phone_numbers")
    .select("id, number_e164")
    .eq("company_id", companyId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (numberError) {
    throw new Error(`widget number lookup failed: ${numberError.message}`);
  }

  const active = (numbers ?? []) as WidgetNumber[];
  if (active.length === 0) return null;

  const chosen = (company as { widget_number_id?: string | null } | null)
    ?.widget_number_id;
  if (chosen) {
    // Matched against the ACTIVE list rather than fetched directly, so a
    // released or suspended choice falls through to the default instead of
    // resolving to a line that cannot send.
    const kept = active.find((number) => number.id === chosen);
    if (kept) return kept;
  }
  return active[0];
}
