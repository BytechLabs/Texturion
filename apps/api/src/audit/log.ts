/**
 * #231 — the workspace audit log's write path.
 *
 * The owner of a JobText number is liable for what happens on it, and a crew
 * churns. "Who turned off the missed-call text-back three weeks ago" and "did
 * the person we let go take the contact list" had one honest answer before
 * this: we don't know. The table (20260726000200_audit_log.sql) is append-only
 * at the DATABASE level — update and delete raise for every role — so what
 * this writes is what a reader gets, months later, whoever holds the keys.
 *
 * WHAT GOES IN: the privileged surface. Membership, access, settings, billing,
 * and bulk contact operations — the things an incident timeline is made of.
 * NOT every message send: the message record is already immutable, and a row
 * per text would be noise and an unbounded bill.
 *
 * WHAT NEVER GOES IN: message bodies, note text, customer content of any kind.
 * `before`/`after` carry the shape of the change (a role, a setting, a count),
 * never the thing itself — an audit log that copies the inbox is a second
 * place for the inbox to leak from.
 *
 * DELIVERY IS BEST EFFORT, and this is a deliberate, stated limit rather than
 * an oversight: the mutation and this write are separate round trips, so a
 * failed audit write cannot roll the action back, and refusing to remove a
 * member because the log was briefly unreachable is the worse failure. A
 * failure raises in Sentry at error level — a gap in the log must be visible
 * to US even though it cannot block the customer. Making it truly fail-closed
 * means moving each mutation into the same transaction as its audit row, which
 * is an RPC per route, not a flag here.
 */
import * as Sentry from "@sentry/cloudflare";
import type { Context } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The privileged actions worth a row. Dotted `subject.verb`, past tense, so a
 * reader scanning a column sees the subject line up.
 *
 * The column is free text on purpose (see the migration): adding an action
 * must never need a migration, or coverage quietly stops keeping up with the
 * product. This union is the contract instead.
 */
export type AuditAction =
  // Membership — who is in the crew, and what they can do
  | "member.invited"
  | "member.invite_revoked"
  | "member.joined"
  | "member.role_changed"
  | "member.deactivated"
  | "member.reactivated"
  // Number access — who can see which number's conversations (#106)
  | "number_access.changed"
  // Settings that change what customers receive
  | "settings.changed"
  // Billing — the plan, the modules, the seats
  | "billing.plan_changed"
  | "billing.module_changed"
  // The end of the account (#341). The most consequential thing anyone does
  // here, and the one an owner is most likely to ask us about afterwards.
  | "workspace.closed"
  | "workspace.reopened"
  // The departing-employee signature (#231: "bulk-export alarm")
  | "contacts.imported"
  | "contacts.exported"
  | "contacts.bulk_deleted";

export interface AuditEntry {
  companyId: string;
  /** Null ONLY for system actors (a cron, a provider webhook). */
  actorUserId: string | null;
  action: AuditAction;
  /** What was acted on: "member", "contact", "company", "phone_number"… */
  targetType: string;
  targetId?: string | null;
  /** Shape of the change — never customer content. */
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  /** Request metadata; both are best-effort (a proxy can omit either). */
  actorIp?: string | null;
  actorAgent?: string | null;
}

/** Bound the agent string: a header is attacker-controlled and unbounded. */
const MAX_AGENT_CHARS = 400;

export async function recordAudit(
  db: SupabaseClient,
  entry: AuditEntry,
): Promise<void> {
  const { error } = await db.from("audit_log").insert({
    company_id: entry.companyId,
    actor_user_id: entry.actorUserId,
    actor_ip: entry.actorIp ?? null,
    actor_agent: entry.actorAgent?.slice(0, MAX_AGENT_CHARS) ?? null,
    action: entry.action,
    target_type: entry.targetType,
    target_id: entry.targetId ?? null,
    before: entry.before ?? {},
    after: entry.after ?? {},
  });
  if (error) {
    // Loud for us, invisible to the customer: the action itself succeeded and
    // must not be undone, but a hole in the log is not something to swallow.
    Sentry.captureMessage(
      `audit_log write failed for ${entry.action} on ${entry.targetType}: ${error.message}`,
      "error",
    );
  }
}

/**
 * The same, with the acting request's identity filled in from the Hono
 * context — the shape every route uses. Kept separate so cron and webhook
 * writers (no request, no actor) cannot accidentally look like a person did it.
 */
export async function recordAuditFromRequest(
  db: SupabaseClient,
  // Loose context type: every /v1 route's AppEnv satisfies this, and the audit
  // writer has no business knowing the rest of the app's context shape.
  c: Pick<Context, "req"> & { get: (key: "userId") => string },
  entry: Omit<AuditEntry, "actorUserId" | "actorIp" | "actorAgent">,
): Promise<void> {
  await recordAudit(db, {
    ...entry,
    actorUserId: c.get("userId"),
    // Cloudflare's own client-IP header first; the proxy chain is not trusted
    // beyond it. Absent (local dev, an odd proxy) reads as unknown rather than
    // as a guess.
    actorIp:
      c.req.header("CF-Connecting-IP") ??
      c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ??
      null,
    actorAgent: c.req.header("User-Agent") ?? null,
  });
}
