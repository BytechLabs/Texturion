/**
 * "For You" home read-model (D23, HOME-AND-VIEWS.md) — the crew member's focus
 * queue. Mounted at /v1; any active member.
 *
 *   GET /v1/for-you  → a WORKING QUEUE ("what do I do next?"), not a
 *        notification log. One object with four urgency-sorted, bounded
 *        sections, all DERIVED over existing tables (conversations,
 *        conversation_reads, tasks, messages) via the api_for_you RPC:
 *
 *          waiting_on_you  conversations assigned to me, open|waiting, not
 *                          spam/closed; urgency-sorted (overdue-linked-task >
 *                          waiting > unread > new), most-recent activity next.
 *          my_tasks        my live OPEN tasks (completion derived from the
 *                          joined messages.done_at, D17); OVERDUE pinned first.
 *          unread          my conversations (assigned to me OR unassigned/open)
 *                          with unread inbound.
 *          triage          owner/admin ONLY — the "needs an owner" strip:
 *                          unassigned open conversations + unassigned open
 *                          tasks. null for a plain member (never leaked).
 *
 *        Company-scoped (§10) and user-scoped: the RPC takes an explicit
 *        p_company_id + p_user_id + the caller's lead flag (owner/admin). No
 *        cursor — each section is a small bounded card list (D23); the Worker
 *        injects the clock so "overdue" is testable.
 */
import { Hono } from "hono";

import { requireRole } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { unwrap } from "./core/http";

export const forYouRoutes = new Hono<AppEnv>();

/**
 * Per-section cap. The focus queue shows the most-urgent handful, not a
 * paginated list (D23 "calm card list"); if a member has more than this in a
 * single section, the surplus lives in the full Inbox / /tasks views.
 */
const SECTION_LIMIT = 20;

forYouRoutes.get("/for-you", requireRole("member"), async (c) => {
  const db = getDb(getEnv(c.env));
  const role = c.get("role");
  // The "Needs an owner" triage strip is owner/admin-only (D23 §4). The lead
  // flag is derived server-side from the verified membership role — never from
  // the request — so a member can't ask for the triage section.
  const isLead = role === "owner" || role === "admin";

  const result = unwrap<Record<string, unknown>>(
    await db.rpc("api_for_you", {
      p_company_id: c.get("companyId"),
      p_user_id: c.get("userId"),
      p_is_lead: isLead,
      p_now: new Date().toISOString(),
      p_limit: SECTION_LIMIT,
    }),
    "for-you read-model",
  );

  return c.json(result);
});
