/**
 * #106 (#80): per-number workspace access control — the resolver every
 * enforcement point shares.
 *
 * Model (decided on #106): each phone number is open to EVERYONE (the default
 * — zero `number_access` rows), or restricted to a role or specific people,
 * at one of two levels:
 *
 *   'text' — full use: send texts, post notes, read.
 *   'note' — read + internal notes only (no outbound texts).
 *   'none' — the number and its conversations are hidden (404, not 403 — a
 *            hidden number should not even be enumerable).
 *
 * Precedence per number: a 'user' row for the caller beats a 'role' row beats
 * an 'all' row; when rows exist for a number and NONE match the caller, the
 * caller has no access. Owners and admins ALWAYS have full access to every
 * number (they manage the rules; no self-lockout) and skip the lookup
 * entirely — the common path costs nothing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { MemberRole } from "../context";
import { ApiError } from "../http/errors";

export type NumberAccessLevel = "text" | "note" | "none";

// #480: `NumberAccessRule` — the shape of a RAW rule row — is gone from here
// too. Nothing outside the CRUD route needs it any more, and a type describing
// the rules invites reading them: naming `principal_kind` in TypeScript is the
// first step of writing the precedence a second time, which is what
// number-access-surfaces.test.ts now refuses.

export interface NumberAccessView {
  /** null = unrestricted (owner/admin, or no rules in the company). Otherwise
   *  the numbers HIDDEN from the caller — a DENY list, so an un-ruled, released,
   *  or NULL number is always visible (consistent with {@link levelFor}, which
   *  returns 'none' only for a ruled-and-unmatched number). Conversation lists
   *  exclude conversations on these ids. */
  hiddenNumberIds: string[] | null;
  levelFor(phoneNumberId: string | null): NumberAccessLevel;
}

const UNRESTRICTED: NumberAccessView = {
  hiddenNumberIds: null,
  levelFor: () => "text",
};

// #480: THE PRECEDENCE RULE USED TO BE HERE, as `levelFromRules`. It is now
// `public.member_number_levels` in
// supabase/migrations/20260730030000_member_number_level.sql, because the
// realtime topic policy has to apply the same rule and an RLS predicate cannot
// call TypeScript.
//
// It is DELETED rather than kept as a convenience, deliberately. A second
// implementation nothing calls is still a second implementation: the next person
// to change the precedence finds it, changes it, and changes nothing. Its unit
// coverage moved to supabase/tests/member_number_level.test.sql (NL-1), which
// asserts the same precedence against the implementation that now decides.
//
// `resolveNumberAccess` below is unchanged in shape and cost — one round trip
// per request, every restricted number at once.

/** The send-path refusal copy — one honest sentence, reused everywhere. */
export const NOTE_ONLY_MESSAGE =
  "This number is view-and-notes only for you. Ask an owner or admin for texting access.";

/**
 * The per-number assert every enforcement point shares (#106). Owners/admins
 * pass with ZERO queries. Throws:
 *   - not_found  when the level is 'none' (a hidden number's conversations
 *     must not even be enumerable — same shape as a wrong id);
 *   - forbidden  when `need` is 'text' but the level is 'note'.
 * 'read' and 'note' are both satisfied by level 'note' (notes-only members
 * read and discuss; they just can't message the customer). Returns the level
 * so callers can surface it (the detail route's `viewer_level`).
 */
export async function assertNumberLevel(
  db: SupabaseClient,
  args: {
    companyId: string;
    userId: string;
    role: MemberRole;
    phoneNumberId: string | null;
    need: "read" | "note" | "text";
  },
): Promise<NumberAccessLevel> {
  const access = await resolveNumberAccess(db, args);
  const level = access.levelFor(args.phoneNumberId);
  if (level === "none") {
    throw new ApiError("not_found", "No such conversation.");
  }
  if (args.need === "text" && level !== "text") {
    throw new ApiError("forbidden", NOTE_ONLY_MESSAGE);
  }
  return level;
}

/**
 * The caller's effective level for a conversation, resolved from its number
 * (#106). Owners/admins and no-rules companies are 'text'; an UNKNOWN
 * conversation is 'text' too (the route's own lookup owns the 404), so this
 * never turns a missing row into a false 'none'. Used where a route needs the
 * level itself — the task detail redacts conversation content at 'none' and
 * hides the text affordance at 'note' (#107).
 */
export async function resolveConversationLevel(
  db: SupabaseClient,
  args: {
    companyId: string;
    userId: string;
    role: MemberRole;
    conversationId: string;
  },
): Promise<NumberAccessLevel> {
  if (args.role === "owner" || args.role === "admin") return "text";

  // Resolve FIRST: the common no-rules company short-circuits without ever
  // touching the conversations table.
  const access = await resolveNumberAccess(db, args);
  if (access.hiddenNumberIds === null) return "text";

  const { data, error } = await db
    .from("conversations")
    .select("phone_number_id")
    .eq("company_id", args.companyId)
    .eq("id", args.conversationId)
    .limit(1);
  if (error) {
    throw new Error(`conversation access lookup failed: ${error.message}`);
  }
  const row = (data ?? [])[0] as { phone_number_id: string | null } | undefined;
  if (!row) return "text";
  return access.levelFor(row.phone_number_id);
}

/**
 * The conversation-id flavor of {@link assertNumberLevel}, for routes that
 * haven't loaded the row (the pinned + thread lists). Unknown conversations
 * pass through so the route's own lookup produces its usual 404.
 */
export async function requireConversationAccess(
  db: SupabaseClient,
  args: {
    companyId: string;
    userId: string;
    role: MemberRole;
    conversationId: string;
    need: "read" | "note" | "text";
  },
): Promise<void> {
  const level = await resolveConversationLevel(db, args);
  if (level === "none") {
    throw new ApiError("not_found", "No such conversation.");
  }
  if (args.need === "text" && level !== "text") {
    throw new ApiError("forbidden", NOTE_ONLY_MESSAGE);
  }
}

/**
 * Resolve the caller's access across the company's numbers — ONE query for
 * members, zero for owners/admins. Builds a DENY list (`hiddenNumberIds`): the
 * numbers whose rules match the caller at level 'none'. Everything else (ruled
 * text/note, un-ruled, released, NULL) is visible, so `levelFor` and the list
 * filter agree by construction.
 */
export async function resolveNumberAccess(
  db: SupabaseClient,
  args: { companyId: string; userId: string; role: MemberRole },
): Promise<NumberAccessView> {
  if (args.role === "owner" || args.role === "admin") return UNRESTRICTED;

  // #480: the RULE lives in SQL now (`member_number_levels`), because the
  // realtime topic policy has to apply the same rule and a policy cannot call
  // TypeScript. Two implementations of one security decision is the drift class
  // D79 exists to prevent, and this is the worst surface to have it on.
  //
  // The shape and the call count here are unchanged — one round trip per
  // request, resolving every restricted number at once. What moved is where the
  // precedence order is written down.
  const { data, error } = await db.rpc("member_number_levels", {
    p_user_id: args.userId,
    p_company_id: args.companyId,
  });
  if (error) {
    throw new Error(`member_number_levels failed: ${error.message}`);
  }
  return buildNumberAccessView(
    (data ?? []) as { phone_number_id: string; level: NumberAccessLevel }[],
  );
}

/**
 * Turn the resolver's rows into the view the routes use.
 *
 * Exported so the premise it rests on is assertable without a database (see
 * premises.test.ts). #480 moved the RULE to SQL and left this here, because this
 * is not the rule — it is how the Worker READS the rule, and getting it wrong is
 * its own silent failure.
 *
 * OMISSION MEANS VISIBLE. The resolver returns rows only for RESTRICTED numbers,
 * so an id it never mentioned is an id nobody restricted: un-ruled, released, or
 * a conversation with no number at all. And only 'none' joins the deny list —
 * 'note' is restricted but not hidden, because a notes-only member is supposed to
 * be reading the thread.
 */
export function buildNumberAccessView(
  rows: readonly { phone_number_id: string; level: NumberAccessLevel }[],
): NumberAccessView {
  if (rows.length === 0) return UNRESTRICTED;

  const levels = new Map<string, NumberAccessLevel>();
  const hidden: string[] = [];
  for (const row of rows) {
    levels.set(row.phone_number_id, row.level);
    if (row.level === "none") hidden.push(row.phone_number_id);
  }

  return {
    hiddenNumberIds: hidden,
    levelFor: (phoneNumberId) =>
      (phoneNumberId !== null && levels.get(phoneNumberId)) || "text",
  };
}
