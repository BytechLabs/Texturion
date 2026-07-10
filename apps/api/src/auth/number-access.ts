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

export interface NumberAccessRule {
  phone_number_id: string;
  principal_kind: "all" | "role" | "user";
  principal: string | null;
  level: "text" | "note";
}

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

/** Pure resolution for one number's rules against one caller. */
export function levelFromRules(
  rules: readonly NumberAccessRule[],
  userId: string,
  role: MemberRole,
): NumberAccessLevel {
  if (rules.length === 0) return "text"; // no rules → everyone, full use
  const user = rules.find(
    (rule) => rule.principal_kind === "user" && rule.principal === userId,
  );
  if (user) return user.level;
  const roleRule = rules.find(
    (rule) => rule.principal_kind === "role" && rule.principal === role,
  );
  if (roleRule) return roleRule.level;
  const all = rules.find((rule) => rule.principal_kind === "all");
  if (all) return all.level;
  return "none"; // rules exist, none match → hidden
}

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

  const { data, error } = await db
    .from("number_access")
    .select("phone_number_id,principal_kind,principal,level")
    .eq("company_id", args.companyId);
  if (error) {
    throw new Error(`number_access lookup failed: ${error.message}`);
  }
  const rules = (data ?? []) as NumberAccessRule[];
  if (rules.length === 0) return UNRESTRICTED;

  const byNumber = new Map<string, NumberAccessRule[]>();
  for (const rule of rules) {
    const list = byNumber.get(rule.phone_number_id) ?? [];
    list.push(rule);
    byNumber.set(rule.phone_number_id, list);
  }

  const levels = new Map<string, NumberAccessLevel>();
  const hidden: string[] = [];
  for (const [numberId, numberRules] of byNumber) {
    const level = levelFromRules(numberRules, args.userId, args.role);
    levels.set(numberId, level);
    if (level === "none") hidden.push(numberId);
  }

  return {
    hiddenNumberIds: hidden,
    // Only a ruled-and-unmatched number is hidden; anything else — un-ruled,
    // released (no rule row), or NULL — is open to everyone.
    levelFor: (phoneNumberId) =>
      (phoneNumberId !== null && levels.get(phoneNumberId)) || "text",
  };
}
