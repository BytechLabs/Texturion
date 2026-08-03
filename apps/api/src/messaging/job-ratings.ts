/**
 * #313 — asking how a finished job went, and recording the answer.
 *
 * The ask is a `scheduled_messages` row with `origin = 'rating'`, so the lease,
 * the exactly-once firing, #331's clearance minted at FIRE time and the
 * hold-and-disclose rules all come from #233. See the migration header for why
 * that is the answer to D47's objection rather than a way around it.
 *
 * THE QUIET-HOURS DIRECTION IS THE OPPOSITE OF A REMINDER'S, AND THAT IS THE
 * ONE THING TO GET RIGHT HERE. #237 walks a reminder BACKWARD out of the quiet
 * window, because it has a deadline: the appointment. A rating has none — the
 * job is already finished — so it defers FORWARD to the morning, which is
 * exactly what `nextSendableInstant` was written for. Using the wrong one is a
 * question arriving at 5am, or a reminder arriving after the van.
 */
import {
  RATING_ASK_BODY,
  RATING_ASK_DELAY_HOURS,
  RATING_ASK_HORIZON_HOURS,
  JOB_RATED_EVENT,
  parseRatingReply,
} from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { unwrap } from "../routes/core/http";
import {
  nextSendableInstant,
  resolveDestinationClock,
} from "./destination-clock";
import { applySendMergeFields, resolveSendMergeFields } from "./merge";

/**
 * Ask about one finished job, if this customer has not been asked lately.
 *
 * Best-effort by contract, and called from the path that marks a job done — a
 * completion must never fail because a satisfaction question could not be
 * queued. Returns what happened so the caller can log something useful rather
 * than a boolean.
 */
export async function askForJobRating(
  db: SupabaseClient,
  input: {
    companyId: string;
    taskId: string;
    userId: string;
    now?: Date;
  },
): Promise<{ outcome: string }> {
  const now = input.now ?? new Date();

  const task = unwrap<{
    conversation_id: string;
    assigned_user_id: string | null;
    conversations: {
      contact_id: string;
      contacts: { phone_e164: string; timezone: string | null } | null;
    } | null;
  } | null>(
    await db
      .from("tasks")
      .select(
        "conversation_id,assigned_user_id," +
          "conversations(contact_id,contacts(phone_e164,timezone))",
      )
      .eq("id", input.taskId)
      .eq("company_id", input.companyId)
      .is("deleted_at", null)
      .maybeSingle(),
    "rating task lookup",
  );
  const conversation = task?.conversations;
  const contactId = conversation?.contact_id;
  const destination = conversation?.contacts?.phone_e164;
  if (!task || !contactId || !destination) return { outcome: "not_found" };

  // The cooldown and the row are ONE statement. Two jobs for the same customer
  // finishing in the same minute would otherwise both read "nothing recent".
  const claim = unwrap<{ outcome: string }>(
    await db.rpc("api_claim_job_rating", {
      p_company_id: input.companyId,
      p_task_id: input.taskId,
      p_conversation_id: task.conversation_id,
      p_contact_id: contactId,
      p_rated_user_id: task.assigned_user_id,
    }),
    "claim job rating",
  );
  if (claim.outcome !== "claimed") return claim;

  // Not immediately. A tech marks the job done in the driveway, and a question
  // arriving thirty seconds later reads as automated because it is.
  const wanted = new Date(
    now.getTime() + RATING_ASK_DELAY_HOURS * 3_600_000,
  );

  const clock = await resolveDestinationClock(db, {
    companyId: input.companyId,
    phoneE164: destination,
    atUtc: wanted,
    contactTimezone: conversation?.contacts?.timezone ?? null,
  });

  // FORWARD, unlike a reminder. See the header: this has no deadline, so
  // "not yet, then 8am" is the right answer rather than "earlier or never".
  const sendAt =
    nextSendableInstant(clock.timezone, clock.region ?? null, wanted) ?? wanted;

  const ctx = await resolveSendMergeFields(db, RATING_ASK_BODY, {
    companyId: input.companyId,
    conversationId: task.conversation_id,
    userId: input.userId,
    timeZone: clock.timezone,
  });

  unwrap(
    await db.from("scheduled_messages").insert({
      company_id: input.companyId,
      conversation_id: task.conversation_id,
      task_id: input.taskId,
      origin: "rating",
      body: applySendMergeFields(RATING_ASK_BODY, ctx),
      send_at: sendAt.toISOString(),
      clock_timezone: clock.timezone,
      clock_source: clock.source,
      expires_at: new Date(
        sendAt.getTime() + RATING_ASK_HORIZON_HOURS * 3_600_000,
      ).toISOString(),
      created_by: input.userId,
    }),
    "queue rating ask",
  );

  return { outcome: "asked" };
}

/**
 * Read a rating out of an inbound message.
 *
 * The caller runs this only on a message the carrier keyword layer did not
 * claim — same ordering rule as #237's confirmation, and for the same reason:
 * short replies are what that layer already owns.
 *
 * Returns the recorded rating, or null when the reply was not one. Nothing is
 * texted back: "thanks for the 5" is a second message the customer did not ask
 * for and a segment nobody budgeted.
 */
export async function recordRatingFromReply(
  db: SupabaseClient,
  input: { companyId: string; conversationId: string; body: string },
): Promise<{ taskId: string; score: number; ratedUserId: string | null } | null> {
  const score = parseRatingReply(input.body);
  if (score === null) return null;

  const result = unwrap<{
    outcome: string;
    task_id?: string;
    score?: number;
    rated_user_id?: string | null;
  }>(
    await db.rpc("api_record_job_rating", {
      p_company_id: input.companyId,
      p_conversation_id: input.conversationId,
      p_score: score,
    }),
    "record job rating",
  );
  // 'nothing_asked' is the common case by far: a bare "3" in a thread where
  // nobody asked anything is an ordinary message about a quantity, and must
  // stay one.
  if (result.outcome !== "recorded" || !result.task_id) return null;

  const { error } = await db.from("conversation_events").insert({
    company_id: input.companyId,
    conversation_id: input.conversationId,
    actor_user_id: null, // the customer, who has no user row
    type: JOB_RATED_EVENT,
    payload: { task_id: result.task_id, score },
  });
  if (error) throw new Error(`job_rated event: ${error.message}`);

  return {
    taskId: result.task_id,
    score,
    ratedUserId: result.rated_user_id ?? null,
  };
}
