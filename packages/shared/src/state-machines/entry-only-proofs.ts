/**
 * #722: every effect that belongs to ENTERING a state fires on entry only. A
 * second pass over the same transition (a replayed webhook, an overlapping
 * poller, a retried request) sends nothing.
 *
 * This registry names, for each machine that has entry effects, the one thing
 * that proves it:
 *
 *   test        a test that applies the same entering transition or event twice
 *               and asserts the effect happened once. `title` is a substring of
 *               the test's name (or, for a SQL suite, of its failure message).
 *   stampsOnly  every entry effect is a column stamp or state cleanup that
 *               cannot reach a person or a provider twice, and the sentence
 *               says why.
 *
 * `entry-only-proofs.test.ts` fails for a machine with entry effects and no
 * entry, an entry for a machine that does not exist, and a named test file or
 * title that is not there. A new machine with entry effects cannot land
 * without saying how a second pass is kept quiet.
 */
export type EntryOnlyProof =
  | { readonly test: string; readonly title: string }
  | { readonly stampsOnly: string };

export const ENTRY_ONLY_PROOFS: Readonly<Record<string, EntryOnlyProof>> = {
  call: {
    test: "apps/api/src/calls/transitions.test.ts",
    title: "T14: a second inbound hangup after the call ended",
  },
  scheduled_message: {
    test: "apps/api/src/messaging/scheduled-send.test.ts",
    title: "tells people once, not every minute it stays held",
  },
  calendar_connection: {
    test: "supabase/tests/calendar_sync.test.sql",
    title: "CS-13 FAILED: delivered disclosure repeated same episode",
  },
  calendar_outbox: {
    stampsOnly:
      "completed and cancelled only stamp completed_at or cancelled_at on a row whose state change is guarded by its lease, and no notice fires from this table.",
  },
  calendar_reminder_replan: {
    stampsOnly:
      "completed and cancelled only stamp completed_at or cancelled_at on a row whose state change is guarded by its lease, and no notice fires from this table.",
  },
  calendar_link: {
    stampsOnly:
      "conflict, event_removed and refused cancel queued outbox rows and write the snapshots the card reads; nothing is sent, and every write is guarded by the link's current state.",
  },
  calendar_push_subscription: {
    test: "supabase/tests/calendar_sync.test.sql",
    title: "CS-13 FAILED: a stopped watch was claimed for a second stopWatch",
  },
  conversation: {
    stampsOnly:
      "closed only stamps closed_at in the same write that sets the status; nothing is sent and a repeat write stamps the same column.",
  },
  conversation_visibility: {
    stampsOnly:
      "spam closes the thread and trashed stamps deleted_at, cancels pending texts and hides tasks, all guarded by deleted_at being null; it stops sends and never makes one.",
  },
  message: {
    test: "apps/api/src/messaging/status.test.ts",
    title: "a failed delivery applied twice is one outcome and one message.failed webhook",
  },
  registration: {
    test: "apps/api/src/telnyx/registration.test.ts",
    title: "tells the owner, sends ops one notice",
  },
  number_health: {
    test: "supabase/tests/number_reputation.test.sql",
    title: "re-assessing unchanged data reported",
  },
  payment_request: {
    test: "apps/api/src/webhooks/stripe-connect.test.ts",
    title: "writes one timeline row however many times the event is delivered",
  },
  phone_number: {
    test: "apps/api/src/telnyx/portout.test.ts",
    title: "marks the number gone, alerts ops and emails the customer once",
  },
  port: {
    test: "apps/api/src/telnyx/porting.test.ts",
    title: "emails once when two deliveries of the same exception overlap",
  },
  port_messaging: {
    test: "apps/api/src/telnyx/porting.test.ts",
    title: "delivered twice sends one texting-delayed email",
  },
  quote: {
    test: "apps/api/src/routes/quotes-send.test.ts",
    title: "the same send applied twice texts the customer once",
  },
  data_export: {
    test: "apps/api/src/workspace/export.test.ts",
    title: "a second run after the export is ready emails the person once",
  },
  consent: {
    stampsOnly:
      "a revoked row only makes the pre-send gate refuse; it sends nothing, so a second one cannot reach anyone.",
  },
  billing_dispute: {
    test: "apps/api/src/billing/disputes.test.ts",
    title: "a lost dispute delivered twice takes the prepaid year back once",
  },
  task: {
    test: "supabase/tests/task_history_and_comments.test.sql",
    title: "TH-2 FAILED: a repeated done wrote",
  },
  invite: {
    test: "apps/api/src/routes/team.test.ts",
    title: "the same acceptance applied twice creates one membership and sends one note",
  },
  workspace: {
    test: "apps/api/src/routes/workspace-closure.test.ts",
    title: "the same close applied twice cancels billing and mails the receipt once",
  },
};
