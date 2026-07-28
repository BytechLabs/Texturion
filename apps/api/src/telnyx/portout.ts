/**
 * #398 — a number leaving us.
 *
 * `porting.ts` handles a number coming IN. Until this existed, nothing handled
 * one going OUT: the `phone_numbers` row stayed active, assigned and billable,
 * texts and calls simply stopped arriving, and we kept charging. An absence is
 * the one failure this product cannot detect on its own (#387), so the carrier
 * telling us is the only signal there is.
 *
 * WHY THE PENDING ALERT IS THE POINT. A port-out completes days after it is
 * requested. Alerting only on completion answers "why did they leave" — useful
 * for churn, useless for the case that actually matters. Port-out fraud is how
 * a business phone number is stolen, and after `ported` there is nothing to
 * stop: every text a homeowner sends that number (an address, a gate code, when
 * the house is empty) goes to whoever holds it. So the FIRST notice we can act
 * on is the one we alert loudest about, and we alert on it even though most
 * port-outs are legitimate customers leaving, because the cost of a needless
 * email is an email.
 *
 * OPERATOR STEP, and this is load-bearing: Telnyx does not send port-out
 * notifications unless they are switched on. Account Settings → Advanced
 * Features → Notifications → a profile, a webhook channel pointing at
 * `/webhooks/telnyx`, and a "Port Out Notifications" setting bound to both.
 * Without that this file never runs, which is why the deploy reference carries
 * it as a step rather than a footnote.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { recordAudit, type AuditAction } from "../audit/log";
import { billingRecipients } from "../billing/recipients";
import { getDb } from "../db";
import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";
import type { TelnyxEvent } from "../messaging/types";

/**
 * Telnyx port-out statuses. `pending` and `authorized` are the actionable
 * window; `ported` is the terminal one that changes our state. The rest are the
 * port failing or being withdrawn, which is good news and still worth a line in
 * the audit log.
 */
export type PortOutStatus =
  | "pending"
  | "authorized"
  | "ported"
  | "rejected"
  | "rejected-pending"
  | "canceled";

/** The statuses where a human still has time to do something about it. */
const ACTIONABLE = new Set<string>(["pending", "authorized"]);

export interface PortOutNotice {
  portoutId: string;
  status: string;
  phoneNumbers: string[];
  carrierName: string | null;
  focDate: string | null;
}

/**
 * Pull what we need out of a `portout.*` payload, defensively — a webhook we
 * cannot parse must never throw inside the dispatcher and cost us the retry.
 */
export function parsePortOutEvent(event: TelnyxEvent): PortOutNotice | null {
  const payload = (event?.data?.payload ?? {}) as Record<string, unknown>;
  const portoutId =
    typeof payload.portout_id === "string"
      ? payload.portout_id
      : typeof payload.id === "string"
        ? payload.id
        : null;
  const status = typeof payload.status === "string" ? payload.status : null;
  const raw = payload.phone_numbers;
  const phoneNumbers = Array.isArray(raw)
    ? raw.filter((n): n is string => typeof n === "string" && n.length > 0)
    : [];
  if (!portoutId || !status || phoneNumbers.length === 0) return null;
  return {
    portoutId,
    status,
    phoneNumbers,
    carrierName:
      typeof payload.carrier_name === "string" ? payload.carrier_name : null,
    focDate: typeof payload.foc_date === "string" ? payload.foc_date : null,
  };
}

function customerCopy(
  companyName: string,
  phone: string,
  status: string,
  appOrigin: string,
): { subject: string; text: string } {
  if (status === "ported") {
    return {
      subject: `${phone} has left ${companyName}`,
      text:
        `Hi,\n\nThe number ${phone} has now moved to another provider, so it ` +
        `no longer sends or receives here. Your conversation history stays in ` +
        `your account and nothing has been deleted.\n\n` +
        `If you did not ask for this, contact us straight away and also ` +
        `contact the provider the number moved to — a number moved without ` +
        `permission needs to be dealt with by both.\n\n` +
        `${appOrigin}/settings/numbers\n\nLoonext`,
    };
  }
  return {
    subject: `Someone has requested to move ${phone} away from ${companyName}`,
    text:
      `Hi,\n\nWe have been told that ${phone} is being moved to another ` +
      `provider. Nothing has changed yet and the number still works here.\n\n` +
      `If this is you, no action is needed and we are sorry to see you go — ` +
      `reply and tell us what went wrong if you have a minute.\n\n` +
      `IF THIS IS NOT YOU, act today. A phone number moved without permission ` +
      `is how a business gets impersonated, and once the move completes every ` +
      `text and call from your customers goes to whoever asked for it. Reply ` +
      `to this email and contact your provider to dispute it.\n\n` +
      `${appOrigin}/settings/numbers\n\nLoonext`,
  };
}

function opsCopy(
  companyName: string,
  companyId: string | null,
  notice: PortOutNotice,
  phone: string,
): { subject: string; text: string } {
  const actionable = ACTIONABLE.has(notice.status);
  return {
    subject: `[ops] port-out ${notice.status}: ${phone} (${companyName})`,
    text:
      `Company: ${companyName} (${companyId ?? "unmatched"})\n` +
      `Number: ${phone}\n` +
      `Port-out id: ${notice.portoutId}\n` +
      `Status: ${notice.status}\n` +
      `Gaining carrier: ${notice.carrierName ?? "unknown"}\n` +
      `FOC date: ${notice.focDate ?? "unknown"}\n\n` +
      (actionable
        ? `THIS IS THE WINDOW. The port has not completed. If the customer did ` +
          `not request it, it can still be disputed with the carrier — after it ` +
          `completes there is nothing to stop, and every customer text to that ` +
          `number reaches whoever took it.\n\n` +
          `If it IS the customer: they are leaving and still paying. This is ` +
          `the only day the conversation is worth having.\n`
        : notice.status === "ported"
          ? `The number is gone. It is marked ported_out and no longer bills as ` +
            `an active number. Check whether the subscription should follow.\n`
          : `The port did not go through. The number is untouched.\n`),
  };
}

/**
 * Handle one `portout.*` webhook.
 *
 * Never throws for a payload we cannot use: the dispatcher acks Telnyx, and a
 * malformed notice must not wedge the retry queue behind it.
 */
export async function handlePortOutEvent(
  env: Env,
  event: TelnyxEvent,
): Promise<void> {
  const notice = parsePortOutEvent(event);
  if (!notice) return;

  const db = getDb(env);
  for (const phone of notice.phoneNumbers) {
    await handleOneNumber(env, db, notice, phone);
  }
}

async function handleOneNumber(
  env: Env,
  db: SupabaseClient,
  notice: PortOutNotice,
  phone: string,
): Promise<void> {
  const { data: rows, error } = await db
    .from("phone_numbers")
    .select("id,company_id,status,companies(name)")
    .eq("number_e164", phone)
    .limit(1);
  if (error) throw new Error(`port-out number lookup failed: ${error.message}`);

  const row = (rows ?? [])[0] as unknown as
    | {
        id: string;
        company_id: string;
        status: string;
        companies: { name: string } | null;
      }
    | undefined;
  const companyId = row?.company_id ?? null;
  const companyName = row?.companies?.name ?? "an unmatched number";

  // Ledger-first, exactly like the grace notices: claim the (portout, status,
  // number) or stop. A replayed webhook must never send a second alert.
  const { data: claimed, error: claimError } = await db.rpc(
    "claim_port_out_notice",
    {
      p_portout_id: notice.portoutId,
      p_status: notice.status,
      p_phone_e164: phone,
      p_company_id: companyId,
      p_carrier_name: notice.carrierName,
      p_foc_date: notice.focDate,
    },
  );
  if (claimError) {
    throw new Error(`port-out claim failed: ${claimError.message}`);
  }
  if (claimed !== true) return; // already seen

  // The number is actually gone: stop treating it as ours.
  if (notice.status === "ported" && row) {
    const { error: updateError } = await db
      .from("phone_numbers")
      .update({ status: "ported_out", ported_out_at: new Date().toISOString() })
      .eq("id", row.id);
    if (updateError) {
      throw new Error(`port-out status update failed: ${updateError.message}`);
    }
  }

  if (companyId) {
    // #345/D22: a number leaving is a lifecycle transition, and the actor is a
    // carrier rather than a person — which is exactly the class #424 says we
    // have no state for. The row is the state.
    await recordAudit(db, {
      companyId,
      actorUserId: null,
      action: `number.port_out.${notice.status}` as AuditAction,
      targetType: "phone_number",
      targetId: row?.id ?? null,
      before: { status: row?.status ?? null },
      after: {
        status: notice.status === "ported" ? "ported_out" : (row?.status ?? null),
        portout_id: notice.portoutId,
        carrier_name: notice.carrierName,
        foc_date: notice.focDate,
      },
    });
  }

  const ops = opsCopy(companyName, companyId, notice, phone);
  await sendEmail(env, {
    to: [env.OPS_ALERT_EMAIL ?? "support@loonext.com"],
    subject: ops.subject,
    text: ops.text,
    html: renderEmailHtml(ops.text),
  });

  // The customer hears about the states that matter to them: someone is taking
  // the number, or it is gone. A rejected port is our problem, not theirs.
  const tellCustomer = ACTIONABLE.has(notice.status) || notice.status === "ported";
  if (!companyId || !tellCustomer) return;

  const to = await billingRecipients(env, companyId, db);
  if (to.length === 0) return;
  const copy = customerCopy(companyName, phone, notice.status, env.APP_ORIGIN);
  await sendEmail(env, {
    to,
    subject: copy.subject,
    text: copy.text,
    html: renderEmailHtml(copy.text),
  });
}
