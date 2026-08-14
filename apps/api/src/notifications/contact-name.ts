/**
 * Who a thread is with, in the one form every alert says it.
 *
 * The rule is three lines long and had been written twice already — the inbound
 * alert reads it off a conversation view it loaded for other reasons, and the
 * assignment alert fetches it on its own. A third copy was about to land with
 * the payment alert, which is the point at which a rule stops being a rule and
 * becomes a coincidence: the fallback to the bare number is load-bearing (a
 * brand-new lead has no name yet, and "assigned you a conversation / (no name)"
 * is useless in exactly the case that matters most), and one copy quietly
 * dropping it would be invisible until somebody complained about a blank push.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** The contact columns every caller selects. */
export interface ContactIdentity {
  name: string | null;
  phone_e164: string;
}

/**
 * The display name, or the number when the contact has no name.
 *
 * A bare number IS an identification — the crew recognises it, and it is the
 * only thing there is to say about somebody who texted for the first time an
 * hour ago.
 */
export function contactDisplayName(contact: ContactIdentity): string {
  return contact.name?.trim() || contact.phone_e164;
}

/**
 * The same answer for a caller holding only a conversation id.
 *
 * Null means the conversation or its contact is gone — deleted between the
 * event and this running. Callers treat that as "nothing to say", never as an
 * error: whatever raised the alert already succeeded.
 */
export async function conversationContactName(
  db: SupabaseClient,
  companyId: string,
  conversationId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("conversations")
    .select("contacts(name,phone_e164)")
    .eq("company_id", companyId)
    .eq("id", conversationId)
    .limit(1);
  if (error) throw new Error(`conversation contact lookup failed: ${error.message}`);
  // Through `unknown`: PostgREST types a one-to-one embed as an array, and the
  // row it actually returns is the object.
  const rows = (data ?? []) as unknown as { contacts: ContactIdentity | null }[];
  const contact = rows[0]?.contacts;
  return contact ? contactDisplayName(contact) : null;
}
