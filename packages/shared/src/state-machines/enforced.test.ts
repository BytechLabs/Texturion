/**
 * #722 phase 2: a machine the database enforces with a transition trigger
 * allows exactly the moves its shared definition allows. The trigger is read
 * from the migration that defines it, so changing one without the other fails.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { billingDisputeMachine } from "./billing-dispute";
import { calendarConnectionMachine } from "./calendar-connection";
import { calendarLinkMachine } from "./calendar-link";
import { calendarOutboxMachine } from "./calendar-outbox";
import { calendarPushSubscriptionMachine } from "./calendar-push-subscription";
import { calendarReminderReplanMachine } from "./calendar-reminder-replan";
import { callMachine } from "./call";
import { callLegMachine } from "./call-leg";
import { conversationVisibilityMachine } from "./conversation-visibility";
import { dataExportMachine } from "./data-export";
import { geocodeMachine } from "./geocode";
import { inviteMachine } from "./invite";
import { messageMachine } from "./message";
import { numberHealthMachine } from "./number-health";
import { paymentRequestMachine } from "./payment-request";
import { phoneNumberMachine } from "./phone-number";
import { portMachine } from "./port";
import { portMessagingMachine } from "./port-messaging";
import { quoteMachine } from "./quote";
import { registrationMachine } from "./registration";
import { scheduledMessageMachine } from "./scheduled-message";
import { subscriptionMachine } from "./subscription";
import { taskMachine } from "./task";
import { textEnablementMachine } from "./text-enablement";
import { webhookDeliveryMachine } from "./webhook-delivery";
import { workspaceMachine } from "./workspace";
import { ALL_MACHINES } from "./index";

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

/** #722 phase 2, the last of the status machines. */
const REMAINING_GUARDS = new Set([
  "number_health_transition_guard",
  "contacts_geocode_transition_guard",
  "tasks_geocode_transition_guard",
  "call_member_legs_transition_guard",
  "billing_disputes_status_forward_only",
  "port_requests_status_forward_only",
  "port_requests_messaging_forward_only",
  "phone_numbers_porting_status_forward_only",
  "companies_subscription_status_forward_only",
]);

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
    ["number_health", numberHealthMachine, "number_health_transition_guard"],
    ["geocode (contacts)", geocodeMachine, "contacts_geocode_transition_guard"],
    ["geocode (tasks)", geocodeMachine, "tasks_geocode_transition_guard"],
    ["call_leg", callLegMachine, "call_member_legs_transition_guard"],
    ["call", callMachine, "calls_transition_guard"],
    ["billing_dispute", billingDisputeMachine, "billing_disputes_status_forward_only"],
    ["port", portMachine, "port_requests_status_forward_only"],
    ["port (number mirror)", portMachine, "phone_numbers_porting_status_forward_only"],
    ["port_messaging", portMessagingMachine, "port_requests_messaging_forward_only"],
    ["subscription", subscriptionMachine, "companies_subscription_status_forward_only"],
  ] as const)("%s: the trigger allows exactly the defined moves", (_name, machine, fn) => {
    const edges = triggerEdges(
      fn === "calls_transition_guard"
        ? "20261111410000_a_call_never_goes_backwards.sql"
        : REMAINING_GUARDS.has(fn)
        ? "20261111400000_the_remaining_machines_keep_their_lifecycles.sql"
        : fn === "phone_numbers_transition_guard"
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

const DERIVED_GUARDS = "20261111440000_invites_workspaces_and_consent_keep_their_lifecycles.sql";

/** The `(v_from = 'x' and v_to in (...))` pairs in a derived machine's guard. */
function derivedGuardEdges(fn: string): Map<string, string[]> {
  const sql = readFileSync(join(MIGRATIONS, DERIVED_GUARDS), "utf8");
  const start = sql.indexOf(`function public.${fn}()`);
  const body = sql.slice(start, sql.indexOf("$$;", start));
  const edges = new Map<string, string[]>();
  for (const match of body.matchAll(/v_from = '([\w-]+)' and v_to in \(([^)]*)\)/g)) {
    edges.set(match[1]!, [...match[2]!.matchAll(/'([\w-]+)'/g)].map((m) => m[1]!).sort());
  }
  return edges;
}

/**
 * How the database holds each machine to its edges: the SQL function that
 * refuses (or keeps the old state on) a move outside the definition, or, for a
 * machine where every move between its states is legal, why it needs none. A
 * new machine fails here until it says which.
 */
const DATABASE_GUARDS: Record<string, { guard: string } | { none: string }> = {
  call: { guard: "calls_transition_guard" },
  call_leg: { guard: "call_member_legs_transition_guard" },
  scheduled_message: { guard: "scheduled_messages_transition_guard" },
  calendar_connection: { guard: "calendar_connections_transition_guard" },
  calendar_outbox: { guard: "calendar_outbox_transition_guard" },
  calendar_reminder_replan: { guard: "calendar_reminder_replans_transition_guard" },
  calendar_link: { guard: "task_calendar_links_transition_guard" },
  calendar_push_subscription: { guard: "webhook_subscriptions_transition_guard" },
  webhook_delivery: { guard: "webhook_deliveries_transition_guard" },
  subscription: { guard: "companies_subscription_status_forward_only" },
  conversation: { none: "a person may set any status, and an inbound text or call reopens a closed one" },
  conversation_visibility: { none: "a restored spam conversation comes back as spam, so every move is legal" },
  message: { guard: "messages_status_forward_only" },
  registration: { guard: "messaging_registrations_status_forward_only" },
  number_health: { guard: "number_health_transition_guard" },
  payment_request: { guard: "payment_requests_transition_guard" },
  phone_number: { guard: "phone_numbers_transition_guard" },
  port: { guard: "port_requests_status_forward_only" },
  port_messaging: { guard: "port_requests_messaging_forward_only" },
  quote: { guard: "quotes_transition_guard" },
  text_enablement: { guard: "text_enablement_orders_status_forward_only" },
  data_export: { guard: "data_exports_transition_guard" },
  consent: { guard: "contact_consent_events_no_downgrade" },
  geocode: { guard: "contacts_geocode_transition_guard" },
  billing_dispute: { guard: "billing_disputes_status_forward_only" },
  task: { none: "open, done and trashed each move to either of the others" },
  invite: { guard: "invites_transition_guard" },
  workspace: { guard: "companies_workspace_transition_guard" },
};

describe("#722 every machine is held by the database", () => {
  it.each([
    ["invite", inviteMachine, "invites_transition_guard"],
    ["workspace", workspaceMachine, "companies_workspace_transition_guard"],
  ] as const)("%s: the derived guard allows exactly the defined moves", (_name, machine, fn) => {
    const edges = derivedGuardEdges(fn);
    expect(edges.size, "the guard was not found or has no edges").toBeGreaterThan(0);
    for (const state of machine.states as readonly string[]) {
      const defined = (machine.transitions as Record<string, readonly string[]>)[state]!
        .filter((to) => to !== state)
        .sort();
      expect(edges.get(state) ?? [], state).toEqual(defined);
    }
  });

  it("names a guard for every machine, or shows it has nothing to refuse", () => {
    const ids = ALL_MACHINES.map((machine) => machine.id).sort();
    expect(ids.length, "no machines were found").toBeGreaterThan(0);
    expect(Object.keys(DATABASE_GUARDS).sort()).toEqual(ids);

    const migrations = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith(".sql"))
      .map((name) => readFileSync(join(MIGRATIONS, name), "utf8"))
      .join("\n");
    const problems: string[] = [];
    for (const machine of ALL_MACHINES) {
      const held = DATABASE_GUARDS[machine.id]!;
      if ("guard" in held) {
        if (!migrations.includes(`function public.${held.guard}()`)) {
          problems.push(`${machine.id}: no migration defines ${held.guard}()`);
        }
        continue;
      }
      // "Nothing to refuse" has to be true of the definition: every state reaches every other.
      const states = machine.states as readonly string[];
      const transitions = machine.transitions as Record<string, readonly string[]>;
      for (const from of states) {
        for (const to of states) {
          if (from !== to && !transitions[from]!.includes(to)) {
            problems.push(`${machine.id}: ${from} -> ${to} is not an edge, so it needs a guard`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
