/**
 * #722 phase 2: a machine the database enforces with a transition trigger
 * allows exactly the moves its shared definition allows. The trigger is read
 * from the migration that defines it, so changing one without the other fails.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { calendarConnectionMachine } from "./calendar-connection";
import { calendarLinkMachine } from "./calendar-link";
import { calendarOutboxMachine } from "./calendar-outbox";
import { calendarPushSubscriptionMachine } from "./calendar-push-subscription";
import { calendarReminderReplanMachine } from "./calendar-reminder-replan";
import { conversationVisibilityMachine } from "./conversation-visibility";
import { dataExportMachine } from "./data-export";
import { inviteMachine } from "./invite";
import { messageMachine } from "./message";
import { paymentRequestMachine } from "./payment-request";
import { phoneNumberMachine } from "./phone-number";
import { quoteMachine } from "./quote";
import { registrationMachine } from "./registration";
import { scheduledMessageMachine } from "./scheduled-message";
import { taskMachine } from "./task";
import { textEnablementMachine } from "./text-enablement";
import { webhookDeliveryMachine } from "./webhook-delivery";
import { workspaceMachine } from "./workspace";

const MIGRATIONS = join(__dirname, "..", "..", "..", "..", "supabase", "migrations");

/** The `old.<column> = 'x' and new.<column> in (...)` pairs in a guard function. */
function triggerEdges(file: string, fn: string): Map<string, string[]> {
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const start = sql.indexOf(`function public.${fn}()`);
  const body = sql.slice(start, sql.indexOf("$$;", start));
  const edges = new Map<string, string[]>();
  for (const match of body.matchAll(/old\.\w+ = '([\w-]+)' and new\.\w+ in \(([^)]*)\)/g)) {
    edges.set(
      match[1]!,
      [...match[2]!.matchAll(/'([\w-]+)'/g)].map((m) => m[1]!).sort(),
    );
  }
  return edges;
}

const CALENDAR_GUARDS = new Set([
  "calendar_connections_transition_guard",
  "task_calendar_links_transition_guard",
  "calendar_outbox_transition_guard",
  "calendar_reminder_replans_transition_guard",
  "webhook_subscriptions_transition_guard",
]);

describe("#722 enforced machines", () => {
  it("scheduled_message: the trigger allows exactly the defined moves", () => {
    const edges = triggerEdges(
      "20261111240000_scheduled_messages_enforce_their_lifecycle.sql",
      "scheduled_messages_transition_guard",
    );
    expect(edges.size, "the trigger was not found or has no edges").toBeGreaterThan(0);
    for (const state of scheduledMessageMachine.states) {
      // A state staying itself is not a status change, so the trigger never sees it.
      const defined = scheduledMessageMachine.transitions[state]
        .filter((to) => to !== state)
        .sort();
      expect(edges.get(state) ?? [], state).toEqual(defined);
    }
  });
  it("message: the trigger allows exactly the defined moves", () => {
    const edges = triggerEdges(
      "20261111310000_messages_never_go_backwards.sql",
      "messages_status_forward_only",
    );
    expect(edges.size, "the trigger was not found or has no edges").toBeGreaterThan(0);
    for (const state of messageMachine.states) {
      const defined = messageMachine.transitions[state].filter((to) => to !== state).sort();
      expect(edges.get(state) ?? [], state).toEqual(defined);
    }
  });
  it.each([
    ["payment_request", paymentRequestMachine, "payment_requests_transition_guard"],
    ["quote", quoteMachine, "quotes_transition_guard"],
    ["data_export", dataExportMachine, "data_exports_transition_guard"],
    ["webhook_delivery", webhookDeliveryMachine, "webhook_deliveries_transition_guard"],
    ["phone_number", phoneNumberMachine, "phone_numbers_transition_guard"],
    ["registration", registrationMachine, "messaging_registrations_status_forward_only"],
    ["text_enablement", textEnablementMachine, "text_enablement_orders_status_forward_only"],
    ["calendar_connection", calendarConnectionMachine, "calendar_connections_transition_guard"],
    ["calendar_link", calendarLinkMachine, "task_calendar_links_transition_guard"],
    ["calendar_outbox", calendarOutboxMachine, "calendar_outbox_transition_guard"],
    ["calendar_reminder_replan", calendarReminderReplanMachine, "calendar_reminder_replans_transition_guard"],
    ["calendar_push_subscription", calendarPushSubscriptionMachine, "webhook_subscriptions_transition_guard"],
  ] as const)("%s: the trigger allows exactly the defined moves", (_name, machine, fn) => {
    const edges = triggerEdges(
      fn === "phone_numbers_transition_guard"
        ? "20261111330000_a_number_keeps_its_lifecycle.sql"
        : fn.endsWith("_status_forward_only")
          ? "20261111340000_registrations_and_text_enablement_keep_their_lifecycles.sql"
          : CALENDAR_GUARDS.has(fn)
            ? "20261111350000_the_calendar_keeps_its_lifecycles.sql"
            : "20261111320000_payments_quotes_exports_and_webhooks_keep_their_lifecycles.sql",
      fn,
    );
    expect(edges.size, "the trigger was not found or has no edges").toBeGreaterThan(0);
    for (const state of machine.states as readonly string[]) {
      const defined = (machine.transitions as Record<string, readonly string[]>)[state]!
        .filter((to) => to !== state)
        .sort();
      expect(edges.get(state) ?? [], state).toEqual(defined);
    }
  });
  it.each([
    ["task", taskMachine, "task_state"],
    ["invite", inviteMachine, "invite_state"],
    ["workspace", workspaceMachine, "workspace_state"],
    ["conversation_visibility", conversationVisibilityMachine, "conversation_visibility"],
  ] as const)("%s: its one SQL definition returns exactly the machine's states", (_name, machine, fn) => {
    const sql = readFileSync(join(MIGRATIONS, "20261111360000_derived_states_have_one_definition.sql"), "utf8");
    const start = sql.indexOf(`function public.${fn}(`);
    expect(start, `${fn} not found`).toBeGreaterThan(-1);
    const body = sql.slice(start, sql.indexOf("$$;", sql.indexOf("$$", start) + 2));
    const returned = [...body.matchAll(/(?:then|else) '([\w-]+)'/g)].map((m) => m[1]!).sort();
    expect(returned).toEqual([...(machine.states as readonly string[])].sort());
  });
});
