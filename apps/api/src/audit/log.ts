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
  // #538: the member took powers off THEMSELVES. Distinct from
  // member.role_changed for the same reason member.left is distinct from
  // member.deactivated — "who removed this admin's access" is the first question
  // after an incident, and an entry that reads identically either way cannot
  // answer it.
  | "member.self_downgraded"
  | "member.deactivated"
  // #406: the member removed THEMSELVES. Distinct from member.deactivated
  // because "who ended this" is the first question anyone asks afterwards, and
  // the answer is different in a way that matters.
  | "member.left"
  | "member.reactivated"
  // #236: an owner or admin signed somebody's devices out. Recorded because
  // it is a privileged action taken against another person's access, and
  // because "when did we cut that phone off" is the question asked the moment
  // anybody wonders how long a departed tech could still read the inbox.
  | "member.sessions_revoked"
  // Ownership (#332). The single most consequential event in a workspace's
  // life: the role that controls spending, numbers, and US texting changing
  // hands. Every step is recorded, not just the completion — "when was the
  // backup named, and by whom" is the first question anyone asks about a
  // handover that turns out to be wrong.
  | "ownership.backup_named"
  // #537: somebody asked for a confirmation code. Recorded because "a code was
  // requested at 14:02 and the handover happened at 14:03" is the shape of an
  // incident review — and a code nobody remembers asking for is the first sign
  // that somebody else has the password.
  | "ownership.code_requested"
  | "ownership.offered"
  | "ownership.claim_started"
  | "ownership.transferred"
  | "ownership.canceled"
  // Number access — who can see which number's conversations (#106)
  | "number_access.changed"
  // Settings that change what customers receive
  | "settings.changed"
  // #419: saved replies. Recorded because a template is the only object where
  // one person's edit changes what EVERYONE says to customers — a bad message
  // is one message, a bad template is every future send by every crew member
  // until somebody notices. The permission stays member-level; this is what
  // makes that defensible.
  | "template.created"
  | "template.updated"
  | "template.deleted"
  /**
   * #246: two customer records folded into one.
   *
   * Recorded because a merge is destructive in a way nothing else on a contact
   * is — it moves somebody's whole history under a different record, and the
   * undo restores the row but cannot restore which thread came from which. The
   * entry carries both numbers and the counts, so "what did that merge
   * actually do" has an answer months later.
   */
  | "contact.merged"
  | "contact.unmerged"
  // Billing — the plan, the modules, the seats
  | "billing.plan_changed"
  | "billing.module_changed"
  // #422: a charge was disputed. Recorded because the money moving backwards
  // is a fact about the account that outlives the dispute itself, and because
  // the decision it forces — keep serving them or not — is one somebody will
  // want to see the history of afterwards.
  | "billing.disputed"
  // #421: somebody scheduled the subscription to end. It reads as a billing
  // change and behaves as a destructive one — 30 days later the number is
  // released and given to another business — so it belongs in the record that
  // cannot be rewritten.
  | "billing.cancellation_scheduled"
  // #277: the seasonal pause, both directions. Recorded because a pause changes
  // what the workspace can DO — nobody can send while it is on — so "why did
  // texting stop in November" needs an answer that names who pressed it, and
  // because it is the one billing change the customer makes in order to spend
  // LESS, which is exactly the kind of thing a support conversation later turns
  // on.
  | "billing.paused"
  | "billing.resumed"
  // #523: somebody paid to bring a held number back. Recorded because it moves
  // money on a recurring line AND changes which numbers the business can work
  // from — the two facts a "why are we paying $5 more" conversation turns on,
  // and the row is the only place they are written down together.
  | "billing.number_reinstated"
  // The end of the account (#341). The most consequential thing anyone does
  // here, and the one an owner is most likely to ask us about afterwards.
  | "workspace.closed"
  | "workspace.reopened"
  // #404: actions taken by a PLATFORM operator rather than by anyone in the
  // workspace — the support fixes that used to be hand-written SQL leaving no
  // trace at all. They carry a null actor (the schema's system-actor slot) and
  // a `platform-ops/<script>` agent, so a reader can tell a support edit from
  // a background job.
  | "spam.cleared"
  // #250: the inbound classifier, and the manual block that outranks it. All
  // three carry a null actor for the arrival cases — nobody pressed anything
  // when a robotext landed — while `spam.sender_blocked` names the member who
  // decided, because that one is a person refusing a number.
  | "spam.suspected"
  | "spam.blocked_sender_arrived"
  | "spam.sender_blocked"
  | "spam.sender_unblocked"
  | "registration.reset"
  // Who this business may still contact (#331). The one kind of change
  // nobody on the crew can undo, and the first thing anyone reaches for when
  // a customer says they asked to be left alone.
  | "opt_out.recorded"
  // #396: an inbound message READ as a plain-English opt-out. Not an opt-out
  // — a warning to the crew. Recorded because "we were told, and we knew" is
  // the fact that decides a TCPA dispute.
  | "opt_out.language_detected"
  // A number leaving us (#398). The actor is a CARRIER, not a person — the
  // customer moving on, or somebody taking the number from them. Recorded at
  // every status because "has anyone tried this before" is the question asked
  // after the fact, and the pending notice is the only one that was ever
  // actionable.
  | "number.port_out.pending"
  | "number.port_out.authorized"
  | "number.port_out.ported"
  | "number.port_out.rejected"
  | "number.port_out.rejected-pending"
  | "number.port_out.canceled"
  | "opt_out.revoked"
  /**
   * #307: how a line answers the phone changed — its name, greeting or away
   * reply. Recorded because it is what a CALLER meets, and "who changed how
   * we answer" is asked after somebody complains about the greeting rather
   * than at the time.
   */
  | "number.identity_changed"
  // #309: who recorded the voice a caller hears, and who took it away.
  | "voicemail_greeting.recorded"
  | "voicemail_greeting.deleted"
  /**
   * #309: somebody asked us to ring a phone so a greeting could be recorded
   * over it. Recorded for two reasons at once — it is a call this product
   * places to a number a member typed, which is worth a name against it; and
   * the rows themselves ARE the daily ceiling on that dial, since a capture
   * leg writes no `calls` row and the voice cap can therefore never see it.
   */
  | "voicemail_greeting.capture_call"
  /**
   * #301: the workspace's marketing vocabulary. Recorded because it is the
   * AXIS of a report about where the money comes from — renaming or archiving
   * a source silently changes what last quarter looks like, and "who changed
   * what our sources are called" is the question asked the moment two reports
   * disagree.
   */
  | "lead_source.created"
  | "lead_source.renamed"
  | "lead_source.archived"
  | "lead_source.restored"
  // The departing-employee signature (#231: "bulk-export alarm")
  | "contacts.imported"
  | "contacts.exported"
  | "contacts.bulk_deleted"
  /**
   * #304: the workspace's metered usage for a window, taken as a file.
   *
   * Not on the departing-employee axis above — it carries no customer data,
   * only counts — but it is still a copy of the workspace's commercial picture
   * leaving the product, and "who pulled our numbers, and for what period" is
   * a question an owner is entitled to be able to answer.
   */
  | "usage.exported"
  /**
   * #303: the AUP enforcement ladder was applied to this workspace.
   *
   * Written by a database TRIGGER, not by this Worker — the runbook is
   * explicit that enforcement is applied by a human in psql today, and a route
   * records only what passes through it. Listed here anyway because this union
   * is the contract for what may appear in the column, and a reader scanning
   * `action` will meet these.
   *
   * `actor_user_id` is null on all three: a platform decision, taken by nobody
   * inside the workspace.
   */
  | "aup.rate_limited"
  | "aup.suspended"
  | "aup.lifted"
  /**
   * #317: a member pulled a file back for the whole workspace, or an owner let
   * it go again. Recorded because it is one member's judgement overriding
   * everybody else's access — the same reason `member.sessions_revoked` is
   * here — and because "who stopped this, and when" is the first question
   * asked afterwards, whichever way the call turns out to have been.
   */
  | "attachment.quarantined"
  | "attachment.released";

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
): Promise<boolean> {
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
    return false;
  }
  return true;
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
