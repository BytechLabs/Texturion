/**
 * #397 ask 2 — notice when ONE customer's calls stop arriving.
 *
 * The competitive risk #397 describes ends with a contractor pointing their
 * number at an AI receptionist. Texting keeps working, so nothing breaks
 * loudly; the calls simply stop, and we find out at renewal. Porting out is a
 * one-way door, and by the time it appears in churn it is already irreversible.
 *
 * `channel:telnyx-call-events` already notices call events stopping — but
 * FLEET-WIDE, which catches a Telnyx outage. At our size one workspace going
 * silent does not move that signal at all, and one workspace is exactly the
 * case here: not our infrastructure failing, one customer quietly replacing us.
 *
 * The issue's own devil's advocate is why this is the half that got built:
 * *"the defensive half — knowing when we are being replaced — is cheap and
 * worth doing regardless, while the offensive half is a real bet."*
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getDb } from "../db";
import { renderEmailHtml } from "../email/html";
import { sendEmail } from "../email/resend";
import type { Env } from "../env";

/** One workspace whose call state changed. */
interface SilenceTransition {
  company_id: string;
  company_name: string | null;
  was: string;
  state: string;
  recent_calls: number;
  baseline_calls: number;
}

export async function runCallSilenceJob(
  env: Env,
  _now: Date = new Date(),
  db: SupabaseClient = getDb(env),
): Promise<SilenceTransition[]> {
  const { data, error } = await db.rpc("api_assess_call_silence");
  if (error) throw new Error(`call silence assessment failed: ${error.message}`);

  const transitions = (data ?? []) as SilenceTransition[];
  if (transitions.length === 0) return transitions;

  const gone = transitions.filter((row) => row.state === "silent");
  const back = transitions.filter((row) => row.state === "ok");

  const parts: string[] = [];
  if (gone.length > 0) {
    parts.push(
      `${gone.length} workspace(s) stopped receiving calls:\n` +
        gone
          .map(
            (row) =>
              `  ${row.company_name ?? row.company_id}: 0 in the last fortnight, ` +
              `usually about ${row.baseline_calls}`,
          )
          .join("\n"),
      "",
      "Their texting is probably still working, which is why this is quiet. " +
        "The likeliest explanations are worth checking in this order: the " +
        "number was pointed at another service, a port-out is in flight " +
        "(#398 alerts separately on that), or voice simply broke for them.",
      "",
      "Porting out is a one-way door. This is the window in which a " +
        "conversation is still possible.",
    );
  }
  if (back.length > 0) {
    parts.push(
      `${back.length} workspace(s) started receiving calls again:\n` +
        back.map((row) => `  ${row.company_name ?? row.company_id}`).join("\n"),
    );
  }

  const text = parts.join("\n");
  await sendEmail(env, {
    to: [env.OPS_ALERT_EMAIL ?? "support@loonext.com"],
    subject:
      gone.length > 0
        ? `[ops] ${gone.length} workspace(s) stopped receiving calls`
        : `[ops] call traffic resumed for ${back.length} workspace(s)`,
    text,
    html: renderEmailHtml(text),
  });

  return transitions;
}
