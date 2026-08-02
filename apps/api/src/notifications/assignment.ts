/**
 * "This one's yours now" — the alert for being handed work.
 *
 * #515 asked why notifications only cover texts and calls, and named the For
 * You page as the thing they should cover. That page is two sections wide:
 * `waiting_on_you` (conversations assigned to me) and `my_tasks` (tasks
 * assigned to me). Both were reachable ONLY by opening the app and looking.
 *
 * The bell already knew — the D24 read-model unions assigned-to-me and
 * task-assigned-to-me into the feed — so the gap was never "we don't track
 * it", it was that the one channel which reaches a person who is not looking
 * stopped at customer traffic. A crew lead reassigning a job at 7am was
 * addressing somebody who would find out whenever they next opened their
 * phone, which is exactly the shape of a missed job.
 *
 * PUSH-ONLY, deliberately, the same posture as mentions and missed calls
 * (D45). `notification_prefs` has one email switch and it means "a customer
 * texted us"; spending it here would mail people who never asked for it.
 *
 * ACCESS is re-checked HERE rather than trusted from the route, for the same
 * reason `notifyNoteMention` re-checks it: the route validated membership
 * before it wrote, but membership and number access can both change between
 * the write and this running, and the alert carries a contact's name or a task
 * title. A member who lost access in that window is simply not told.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { listConversationViewers } from "../auth/conversation-audience";
import { getDb } from "../db";
import type { Env } from "../env";

import { deliverPush } from "./deliver";

/**
 * A conversation handed to somebody, or a task handed to somebody.
 *
 * One function rather than two because everything except the noun is shared —
 * the self-assign skip, the access re-check, the prefs read, the actor's name,
 * the #430 withholding posture — and two copies of that would drift on the
 * first change to any of it.
 */
export type AssignmentNotification = {
  companyId: string;
  /** Who did the assigning. Never notified about their own action. */
  actorUserId: string;
  /** Who now owns it. */
  assigneeUserId: string;
} & (
  | { kind: "conversation"; conversationId: string }
  | {
      kind: "task";
      taskId: string;
      /** Title as typed by a member, for the alert's second line. */
      title: string | null;
      /** Where the task lives, so the link lands on the thread when it has one. */
      conversationId: string | null;
    }
  /**
   * A whole selection handed over at once — ONE alert saying how many.
   *
   * The bulk route accepts up to 1000 ids, and a filter arm that can match the
   * entire inbox. Reusing the per-conversation path there would fan one tap out
   * into a thousand pushes at a thousand contact names, which is a cost centre,
   * a notification-shade wipeout, and a plausible way to get the sender's
   * credentials rate-limited by Apple and Google. So the count IS the message:
   * it says what happened and sends them to the one place that shows it.
   */
  | { kind: "conversation_bulk"; count: number }
);

interface PrefsRow {
  user_id: string;
  push_enabled: boolean;
}

function unwrapRows<T>(
  result: { data: unknown; error: { message: string } | null },
  what: string,
): T[] {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`);
  return (result.data ?? []) as T[];
}

/**
 * The alert's two lines, and what survives when the workspace has turned
 * content off (#430).
 *
 * A conversation is identified by the CONTACT, and a task by a title a member
 * typed — per docs/PERSONAL-DATA-INVENTORY.md a task title routinely carries a
 * name and a job address ("Alvarez, 42 Elm, gate code 4417"). So in both cases
 * the identifying line is a person's words and is the line that is withheld;
 * what survives is our own sentence, which still says somebody gave you work
 * and still deep-links to it. A push that says "Dana assigned you a
 * conversation" is a complete instruction even with the name removed.
 */
interface Alert {
  title: string;
  body: string;
  url: string;
  /** Structural discriminator for the native clients. */
  nativeKind: "conversation_assigned" | "task_assigned";
  /**
   * Whose words the alert carries, and what it degrades to when the workspace
   * has turned content off (#430). A bulk alert is entirely our own sentence
   * and a number, so it has nothing to withhold and says so.
   */
  written: "people" | "us";
  /** What the alert degrades to when content must not leave (#430). */
  withheld: { title: string } | { body: string };
  /** One per assigned THING: a re-assignment replaces its own earlier alert. */
  collapseKey: string;
}

export async function notifyAssigned(
  env: Env,
  input: AssignmentNotification,
  db: SupabaseClient = getDb(env),
): Promise<void> {
  // Handing something to yourself is not news. This is the common case for the
  // "claim it" button, so it is checked before any query runs.
  if (input.assigneeUserId === input.actorUserId) return;

  // The conversation a conversation-assignment is about, or the one a task
  // hangs off — the same row answers number access for both, and a task with no
  // conversation has no number to be restricted by.
  //
  // A bulk hand-off has no single conversation to check, and needs none: the
  // RPC already filtered the selection by the ASSIGNER's number access, the
  // alert names no contact, and the inbox it links to applies the reader's own
  // access when it loads. So it falls to the membership branch below.
  const conversationId: string | null =
    input.kind === "conversation_bulk" ? null : input.conversationId;

  if (conversationId !== null) {
    const conversations = unwrapRows<{ phone_number_id: string | null }>(
      await db
        .from("conversations")
        .select("phone_number_id")
        .eq("company_id", input.companyId)
        .eq("id", conversationId)
        .limit(1),
      "conversation lookup",
    );
    const conversation = conversations[0];
    // Deleted between the assignment and this running. Nothing to point at, so
    // nothing to say — and NOT an error, because the assignment itself
    // succeeded and the caller must not be told it failed.
    if (!conversation) return;

    // #106: the same viewer list the route would have used. Assigning work on a
    // number somebody cannot see is a mistake the assigner should discover, but
    // it is not fixed by pushing them the contact's name.
    const viewers = await listConversationViewers(db, {
      companyId: input.companyId,
      phoneNumberId: conversation.phone_number_id,
    });
    if (!viewers.some((row) => row.user_id === input.assigneeUserId)) return;
  } else {
    // A standalone task has no number to check, so membership is the whole
    // question — and it is asked here rather than inferred, because a member
    // deactivated in this window must not be woken.
    const members = unwrapRows<{ user_id: string }>(
      await db
        .from("company_members")
        .select("user_id")
        .eq("company_id", input.companyId)
        .eq("user_id", input.assigneeUserId)
        .is("deactivated_at", null)
        .limit(1),
      "assignee membership lookup",
    );
    if (members.length === 0) return;
  }

  const prefRows = unwrapRows<PrefsRow>(
    await db
      .from("notification_prefs")
      .select("user_id,push_enabled")
      .eq("company_id", input.companyId)
      .eq("user_id", input.assigneeUserId),
    "notification prefs lookup",
  );
  // A missing row reads as the §6 defaults, which have push on.
  if (prefRows[0]?.push_enabled === false) return;

  const actorName = await assignerName(db, input.actorUserId);
  const contactName =
    input.kind === "conversation"
      ? await conversationContactName(db, input.companyId, input.conversationId)
      : null;
  const alert = assignmentAlert(
    env.APP_ORIGIN,
    input,
    actorName,
    contactName,
  );
  if (!alert) return;

  const failures: unknown[] = [];
  await deliverPush(env, db, {
    userIds: [input.assigneeUserId],
    content: {
      written: alert.written,
      companyId: input.companyId,
      withheld: alert.withheld,
    },
    web: { title: alert.title, body: alert.body, url: alert.url },
    // Web Push stays kind-less (the service worker renders unmarked pushes as
    // ordinary notices); the native clients route on `kind`.
    native: {
      kind: alert.nativeKind,
      title: alert.title,
      body: alert.body,
      url: alert.url,
    },
    collapseKey: alert.collapseKey,
    failures,
  });

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `assignment alert: ${failures.length} delivery step(s) failed for ${alert.collapseKey}`,
    );
  }
}

/** The name on the alert, or an honest stand-in when the profile is gone. */
async function assignerName(
  db: SupabaseClient,
  actorUserId: string,
): Promise<string> {
  const rows = unwrapRows<{ display_name: string | null }>(
    await db
      .from("profiles")
      .select("display_name")
      .eq("user_id", actorUserId)
      .limit(1),
    "assigner lookup",
  );
  return rows[0]?.display_name?.trim() || "A teammate";
}

/** How long a task title may run before the lock screen truncates it for us. */
const TITLE_LENGTH = 80;

/**
 * The alert's text and link, given everything already looked up.
 *
 * Exported and PURE so the wording, the deep links and the collapse keys can be
 * asserted directly — the delivered payload is encrypted, so a test that only
 * watched the wire could count sends and never once check that the right words
 * were in them.
 */
export function assignmentAlert(
  origin: string,
  input: AssignmentNotification,
  actorName: string,
  /** Who the thread is with. Required by the single-conversation arm only. */
  contactName: string | null,
): Alert | null {
  const env = { APP_ORIGIN: origin };
  if (input.kind === "conversation_bulk") {
    if (input.count <= 0) return null;
    const noun = input.count === 1 ? "conversation" : "conversations";
    return {
      title: `${actorName} assigned you ${input.count} ${noun}`,
      // No contact names, deliberately: the point of one alert for a selection
      // is that it does not enumerate the selection. "Open your inbox" is the
      // only next step there is, and the link already performs it.
      body: "Open your inbox to see them",
      url: `${env.APP_ORIGIN}/inbox`,
      nativeKind: "conversation_assigned",
      // Our own sentence and a count — no customer content to withhold.
      written: "us",
      withheld: { body: "Open your inbox to see them" },
      // Per PERSON, not per conversation: a second bulk assign replaces the
      // first rather than stacking, because the newer count supersedes it.
      collapseKey: `assigned:bulk:${input.assigneeUserId}`,
    };
  }

  if (input.kind === "task") {
    const title = (input.title ?? "").trim().slice(0, TITLE_LENGTH) || "A task";
    return {
      // #414's ordering: the first line says WHAT this is before it says who
      // it is about, because a phone on a bedside table shows one line and
      // "you have been given a job" is the part that decides whether it is
      // picked up now.
      title: `${actorName} assigned you a task`,
      body: title,
      url: input.conversationId
        ? `${env.APP_ORIGIN}/inbox/${input.conversationId}?task=${input.taskId}`
        : `${env.APP_ORIGIN}/tasks/${input.taskId}`,
      nativeKind: "task_assigned",
      written: "people",
      // The member-typed title goes; our own sentence stays.
      withheld: { body: "Open the app to see it" },
      collapseKey: `assigned:task:${input.taskId}`,
    };
  }

  if (contactName === null) return null;
  return {
    title: `${actorName} assigned you a conversation`,
    body: contactName,
    url: `${env.APP_ORIGIN}/inbox/${input.conversationId}`,
    nativeKind: "conversation_assigned",
    written: "people",
    withheld: { body: "Open the app to see it" },
    collapseKey: `assigned:conversation:${input.conversationId}`,
  };
}

/**
 * Who the thread is with — the contact's name, or their number when unnamed.
 *
 * The same fallback the inbound alert uses, and for the same reason: a bare
 * number is still an identification, and "assigned you a conversation / (no
 * name)" would make the alert useless in exactly the case (a brand new lead)
 * where being handed one matters most.
 */
async function conversationContactName(
  db: SupabaseClient,
  companyId: string,
  conversationId: string,
): Promise<string | null> {
  const rows = unwrapRows<{
    contacts: { name: string | null; phone_e164: string } | null;
  }>(
    await db
      .from("conversations")
      .select("contacts(name,phone_e164)")
      .eq("company_id", companyId)
      .eq("id", conversationId)
      .limit(1),
    "conversation contact lookup",
  );
  const contact = rows[0]?.contacts;
  if (!contact) return null;
  return contact.name?.trim() || contact.phone_e164;
}
