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
  copyForContact,
  RATING_ASK_DELAY_HOURS,
  RATING_ASK_HORIZON_HOURS,
  JOB_RATED_EVENT,
  isPoorRating,
  parseRatingReply,
} from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { listConversationViewers } from "../auth/conversation-audience";
import { insertConversationEvents } from "../routes/core/events";
import type { Env } from "../env";
import { deliverPush } from "../notifications/deliver";
import { unwrap } from "../routes/core/http";
import {
  nextSendableInstant,
  resolveDestinationClock,
} from "./destination-clock";
import { POOR_RATING_PUSH_COPY } from "./job-ratings-copy";
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
      contact_phone_e164: string | null;
    contacts: { timezone: string | null; locale: string | null } | null;
    } | null;
  } | null>(
    await db
      .from("tasks")
      .select(
        "conversation_id,assigned_user_id," +
          // #291: the thread's number; the timezone stays the
          // contact's.
          "conversations(contact_id,contact_phone_e164,contacts(timezone,locale))",
      )
      .eq("id", input.taskId)
      .eq("company_id", input.companyId)
      .is("deleted_at", null)
      .maybeSingle(),
    "rating task lookup",
  );
  const conversation = task?.conversations;
  const contactId = conversation?.contact_id;
  const destination = conversation?.contact_phone_e164;
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

  // #228: the language this customer reads. The company row is read here
  // rather than ridden in on the task lookup because the rating ask is
  // scheduled hours after the job, off the hot path, where one indexed read
  // costs nothing.
  const companyRow = await db
    .from("companies")
    .select("locale")
    .eq("id", input.companyId)
    .limit(1);
  const ratingAsk = copyForContact(
    conversation?.contacts?.locale ?? null,
    ((companyRow.data ?? [])[0] as { locale: string | null } | undefined)?.locale ?? null,
  ).ratingAsk;

  const ctx = await resolveSendMergeFields(db, ratingAsk, {
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
      body: applySendMergeFields(ratingAsk, ctx),
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

  // #554: through the TYPED helper, so a type this union cannot express is a
  // compile error rather than a caught-and-logged runtime one. The hand-rolled
  // insert that used to be here is how 'job_rated' shipped without ever being
  // added to the enum.
  //
  // AND IT NO LONGER THROWS. The score is already committed by
  // api_record_job_rating, and the caller runs escalatePoorRating on the value
  // this function returns — so throwing here meant a missing timeline row also
  // swallowed the alert to the owner, which is the more important of the two by
  // a distance. A thread that is missing one line is recoverable; a 1-out-of-5
  // nobody hears about is the failure #313 exists to prevent.
  try {
    await insertConversationEvents(db, [
      {
        company_id: input.companyId,
        conversation_id: input.conversationId,
        actor_user_id: null, // the customer, who has no user row
        type: JOB_RATED_EVENT,
        payload: { task_id: result.task_id, score },
      },
    ]);
  } catch (cause) {
    console.error("job_rated event failed, rating still recorded:", cause);
  }

  return {
    taskId: result.task_id,
    score,
    ratedUserId: result.rated_user_id ?? null,
  };
}

/**
 * #313 — tell somebody about a bad answer, today.
 *
 * "A poor answer reaches the owner immediately, as something needing a human
 * today, not a statistic in a monthly report." A dissatisfied customer
 * contacted within a day is often recoverable; one contacted never leaves a
 * review instead.
 *
 * PUSH ONLY, and to everyone who can see the thread. Email arriving tomorrow
 * about a customer who was unhappy this afternoon has already lost, and the
 * person who did the job may be on a roof — this is the workspace's problem,
 * not one member's inbox.
 *
 * The score is in the notification and the customer's words are NOT. They did
 * not write any: the answer is a digit. What a lock-screen carries here is
 * entirely ours, which is what `content: { written: "us" }` asserts.
 *
 * Stamped on the row before sending, so a redelivered webhook or a second reply
 * cannot wake the crew twice about one unhappy customer. Best-effort after
 * that: the rating is already recorded and visible in the thread, so a dead
 * device degrades the alert rather than losing the signal.
 */
export async function escalatePoorRating(
  env: Env,
  db: SupabaseClient,
  input: {
    companyId: string;
    conversationId: string;
    taskId: string;
    score: number;
  },
): Promise<void> {
  if (!isPoorRating(input.score)) return;

  // Claim the escalation FIRST. `is null` makes this the same
  // one-winner-only shape the rest of the queue uses: a concurrent second
  // reply updates nothing and sends nothing.
  const claimed = unwrap<Record<string, unknown>[]>(
    await db
      .from("job_ratings")
      .update({ escalated_at: new Date().toISOString() })
      .eq("company_id", input.companyId)
      .eq("task_id", input.taskId)
      .is("escalated_at", null)
      .select("id"),
    "claim rating escalation",
  );
  if (claimed.length === 0) return;

  const conversation = unwrap<{ phone_number_id: string | null } | null>(
    await db
      .from("conversations")
      .select("phone_number_id")
      .eq("id", input.conversationId)
      .eq("company_id", input.companyId)
      .maybeSingle(),
    "rating conversation lookup",
  );

  // WHO gets told: the people who can see this thread, which under #106 is not
  // everyone in the workspace. A member with no access to that number learning
  // a customer on it was unhappy is the leak that access control exists to
  // stop. `deliverPush` already no-ops on an empty list, so there is no guard
  // for that case here.
  const viewers = await listConversationViewers(db, {
    companyId: input.companyId,
    phoneNumberId: conversation?.phone_number_id,
  });

  const failures: unknown[] = [];
  await deliverPush(env, db, {
    category: "assignments",
    companyId: input.companyId,
    failures,
    userIds: viewers.map((viewer) => viewer.user_id),
    content: { written: "us" },
    // One alert per rating. A rating cannot change — the RPC refuses a second
    // answer — so this is belt and braces on the claim above.
    collapseKey: `rating:${input.taskId}`,
    // #228: composed per reader. The audience here is a whole crew rather than
    // one person, so this is the site where two members of the same workspace
    // can legitimately need two different languages for one rating.
    web: (locale) => {
      const copy = POOR_RATING_PUSH_COPY[locale];
      return {
        title: copy.title,
        // The score is a digit, not copy: it crosses into the sentence
        // unchanged in either language.
        body: copy.body(input.score),
        url: `${env.APP_ORIGIN}/inbox/${input.conversationId}`,
      };
    },
  });

  if (failures.length > 0) {
    console.error(
      `job rating: ${failures.length} escalation push(es) failed for ${input.taskId}`,
    );
  }
}
