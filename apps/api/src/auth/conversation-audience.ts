/**
 * Who may see a given conversation.
 *
 * Every background sender that names a customer, quotes their message, or deep
 * links into a thread has to answer this question, and until now each one
 * answered it with its own copy of the same twenty lines. Two copies had
 * already drifted into place (inbound message alerts and missed-call alerts);
 * a third would have shipped with mentions.
 *
 * The rule (#106): an ACTIVE member of the company whose access level on the
 * conversation's number is not 'none'. Owners and admins always pass. Level
 * 'note' is INSIDE the set: a notes-only member reads the thread and posts
 * notes, so gating on 'text' would drop a legitimate reader.
 *
 * Number access is a DENY-LIST: a number with no rules at all is visible to
 * everyone, and a conversation with no number (`phone_number_id` null) is
 * visible to the whole company. Both mirror the SQL-side filter.
 *
 * #581: and the member's ROLE has to carry `conversations.read`, because number
 * access alone answers the wrong question. Every default in the paragraph above
 * resolves to "the whole company", and since the #315 presets landed, belonging
 * to a workspace no longer implies inbox access — `bookkeeper` is billing and no
 * conversations at all. Without this half, an unruled number (which is every
 * number in a workspace that has never written a rule) put the customer's name
 * in a `Missed call from …` push on the one role documented as never seeing a
 * customer.
 *
 * Takes the number id rather than a conversation id deliberately.
 * `resolveConversationLevel` answers 'text' for a conversation row that does
 * not exist, because routes own their own 404. A background sender has no such
 * fallback, and inheriting that default would mean notifying the whole company
 * about a row that has since vanished. Callers load the conversation under
 * their own company scope first and fail loudly when it is gone.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { roleHasCapability } from "@loonext/shared";

import type { MemberRole } from "../context";


export interface ConversationViewer {
  user_id: string;
  role: MemberRole;
}

/**
 * #581 — asked of the capability table rather than of a role list.
 *
 * A list of roles to exclude here would be a fourth place the #315 model is
 * written down, and the one nobody would remember: the next preset that lands
 * without inbox access would be admitted by default, silently, at the exact
 * moment it was created to be kept out.
 *
 * Fails CLOSED for a role this build has never heard of, because
 * `roleHasCapability` does. For an audience that means "not told" rather than
 * "told anyway" — the `member_role` enum can grow a value ahead of a deployed
 * Worker, and the safe side of that window is a missing alert, not a leaked
 * customer name.
 */
function canReadConversations(viewer: ConversationViewer): boolean {
  return roleHasCapability(viewer.role, "conversations.read");
}

function unwrapRows<T>(
  result: { data: unknown; error: { message: string } | null },
  what: string,
): T[] {
  // A membership or access read that failed must never read as "nobody has
  // access": that silently turns a broken query into a delivered-to-nobody
  // alert. Throw and let the caller's error path own it.
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`);
  return (result.data ?? []) as T[];
}

export async function listConversationViewers(
  db: SupabaseClient,
  args: { companyId: string; phoneNumberId: string | null | undefined },
): Promise<ConversationViewer[]> {
  const members = unwrapRows<ConversationViewer>(
    await db
      .from("company_members")
      .select("user_id,role")
      .eq("company_id", args.companyId)
      .is("deactivated_at", null),
    "company members lookup",
  );

  // No number on the conversation: nothing to restrict against. Absent counts
  // as none, so a projection that simply omits the column cannot cause an
  // access lookup against a number that was never there.
  //
  // #581: "nothing to restrict against" was never true of the role — a
  // conversation with no number is still a conversation.
  if (!args.phoneNumberId) return members.filter(canReadConversations);

  // #480: the rule asked BACKWARDS — given a number, who may see it. This used
  // to read the rules and apply the precedence here, member by member, with its
  // own copy of the owner/admin override: a third place the #106 rule was
  // written down, and the one that decides who gets told about a customer's
  // message. `number_viewers` delegates to the same resolver the realtime topic
  // policy uses, so the precedence has one home.
  const levels = unwrapRows<ConversationViewer & { level: string }>(
    await db.rpc("number_member_levels", {
      p_phone_number_id: args.phoneNumberId,
    }),
    "number member levels lookup",
  );
  // Not hidden is the audience: a notes-only member still gets told, because
  // they can read the thread and are expected to (#106 — 'note' is read plus
  // internal notes, not a lesser kind of membership).
  const viewers = levels
    .filter((row) => row.level !== "none")
    .map(({ user_id, role }) => ({ user_id, role }));
  // An access read that returned nobody where members exist is the failure mode
  // this file's unwrapRows exists to refuse: it would silently turn a broken
  // query into an alert delivered to no one. The resolver returns every member
  // for an unrestricted number, so an empty list with members present cannot be
  // a legitimate answer.
  if (levels.length === 0 && members.length > 0) {
    throw new Error(
      `number_member_levels returned nobody for ${args.phoneNumberId} while ` +
        `the company has ${members.length} member(s)`,
    );
  }
  // #581 last, deliberately: the guard above counts RAW membership, so a
  // workspace whose only members hold no inbox access still turns a broken
  // resolver read into a loud failure rather than into a silent empty audience.
  return viewers.filter(canReadConversations);
}
