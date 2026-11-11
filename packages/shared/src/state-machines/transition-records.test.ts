/**
 * #722 phase 4: every machine's transitions are recorded.
 *
 * Two things are pinned per machine:
 *
 *   capture   the trigger(s) in supabase/migrations/20261111420000_every_state_
 *             transition_is_recorded.sql that send one PostHog `state_transition`
 *             event when the state changes. Checked by parsing the migration for
 *             that trigger name on that table.
 *   activity  where a person sees the move: a record_activity kind (#714), an
 *             audit_log action (#231) with the file that writes it, or `none`
 *             with the reason a row would be noise.
 *
 * It also checks the generated edge list inside the migration against the
 * definitions, so `expected` cannot drift from them.
 *
 * A machine with no row, a trigger that is not in the migration, a kind that
 * record_activity does not accept, or a file that no longer names its action
 * fails. The suite reports how many machines it checked and fails on zero.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ALL_MACHINES } from "./index";

const ROOT = join(__dirname, "..", "..", "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const CAPTURE_MIGRATION = "supabase/migrations/20261111420000_every_state_transition_is_recorded.sql";
const ACTIVITY_MIGRATION = join(MIGRATIONS, "20261111230000_one_activity_for_every_record.sql");

type Activity =
  | { recordActivity: string }
  | { auditLog: string; file: string }
  | { none: string };

interface Row {
  /** `trigger` on `table`; both are looked up in the capture migration. */
  capture: readonly { table: string; trigger: string }[];
  activity: Activity;
}

const entered = (id: string, table: string) => ({ table, trigger: `state_entered_${id}` });
const changed = (id: string, table: string) => ({ table, trigger: `state_transition_${id}` });
const both = (id: string, table: string) => [changed(id, table), entered(id, table)];

const BY_MIGRATION = (action: string): Activity => ({ auditLog: action, file: CAPTURE_MIGRATION });

const NOISE = "high-volume internal pipeline: a row per pass would bury the timeline, PostHog is the record";

const ROSTER: Record<string, Row> = {
  call: { capture: both("call", "calls"), activity: { recordActivity: "call" } },
  call_leg: {
    capture: both("call_leg", "call_member_legs"),
    activity: { none: `${NOISE}; one row per member per ring, and the call's own row carries the outcome` },
  },
  scheduled_message: { capture: both("scheduled_message", "scheduled_messages"), activity: { recordActivity: "scheduled_sent" } },
  calendar_connection: {
    capture: both("calendar_connection", "calendar_connections"),
    activity: BY_MIGRATION("calendar.connection_status_changed"),
  },
  calendar_outbox: {
    capture: both("calendar_outbox", "calendar_outbox"),
    activity: { none: `${NOISE}; a queue row per calendar write` },
  },
  calendar_reminder_replan: {
    capture: both("calendar_reminder_replan", "calendar_reminder_replans"),
    activity: { none: `${NOISE}; a queue row per reminder re-plan` },
  },
  calendar_link: {
    capture: both("calendar_link", "task_calendar_links"),
    activity: { none: "a sync detail of the task's calendar event, which the task's own history already shows; PostHog answers why a link is stuck" },
  },
  calendar_push_subscription: {
    capture: both("calendar_push_subscription", "webhook_subscriptions"),
    activity: { none: `${NOISE}; provider watch channels renew on a timer` },
  },
  webhook_delivery: {
    capture: both("webhook_delivery", "webhook_deliveries"),
    activity: { none: `${NOISE}; a row per delivery attempt` },
  },
  subscription: {
    capture: both("subscription", "companies"),
    activity: BY_MIGRATION("billing.subscription_status_changed"),
  },
  conversation: { capture: both("conversation", "conversations"), activity: { recordActivity: "edited" } },
  conversation_visibility: { capture: both("conversation_visibility", "conversations"), activity: { recordActivity: "deleted" } },
  message: {
    capture: both("message", "messages"),
    activity: { none: "delivery status of every text; the text itself is already text_in or text_out on the record and a delivery row per text is noise" },
  },
  registration: { capture: both("registration", "messaging_registrations"), activity: BY_MIGRATION("registration.status_changed") },
  number_health: {
    capture: both("number_health", "number_health"),
    activity: { none: `${NOISE}; reassessed on a schedule for every number` },
  },
  payment_request: {
    capture: both("payment_request", "payment_requests"),
    activity: BY_MIGRATION("payments.request_status_changed"),
  },
  phone_number: { capture: both("phone_number", "phone_numbers"), activity: BY_MIGRATION("number.status_changed") },
  port: {
    capture: [...both("port", "port_requests"), ...both("port", "phone_numbers")],
    activity: BY_MIGRATION("port.status_changed"),
  },
  port_messaging: {
    capture: both("port_messaging", "port_requests"),
    activity: { none: "a sub-step the port itself surfaces; its port.status_changed row is the owner-facing record and the messaging step is one PostHog query" },
  },
  quote: { capture: both("quote", "quotes"), activity: BY_MIGRATION("quote.status_changed") },
  text_enablement: { capture: both("text_enablement", "text_enablement_orders"), activity: BY_MIGRATION("text_enablement.status_changed") },
  data_export: { capture: both("data_export", "data_exports"), activity: BY_MIGRATION("data_export.status_changed") },
  consent: { capture: [entered("consent", "contact_consent_events")], activity: { recordActivity: "opted_out" } },
  geocode: {
    capture: [...both("geocode", "contacts"), ...both("geocode", "tasks")],
    activity: { none: `${NOISE}; a lookup per address edit` },
  },
  billing_dispute: { capture: both("billing_dispute", "billing_disputes"), activity: BY_MIGRATION("billing.dispute_status_changed") },
  task: {
    capture: [...both("task", "tasks"), changed("task_via_message", "messages")],
    activity: { recordActivity: "completed" },
  },
  invite: {
    capture: both("invite", "invites"),
    activity: { auditLog: "member.invited", file: "apps/api/src/routes/team.ts" },
  },
  workspace: {
    capture: both("workspace", "companies"),
    activity: { auditLog: "workspace.closed", file: "apps/api/src/routes/workspace-closure.ts" },
  },
};

const migration = readFileSync(join(ROOT, CAPTURE_MIGRATION), "utf8");

/** `trigger@table` for every `create trigger` in the capture migration. */
const triggers = new Set<string>();
for (const m of migration.matchAll(/create trigger\s+(\w+)\s+after\s+(?:update of [\w, ]+|insert)\s+on\s+public\.(\w+)/g)) {
  triggers.add(`${m[1]}@${m[2]}`);
}

const activityKinds = (() => {
  const text = readFileSync(ACTIVITY_MIGRATION, "utf8");
  const block = /kind\s+text not null check \(kind in \(([\s\S]*?)\)\)/.exec(text);
  if (!block) throw new Error("could not read the record_activity kinds");
  return new Set([...block[1].matchAll(/'(\w+)'/g)].map((m) => m[1]));
})();

describe("every machine's transitions are recorded (#722 phase 4)", () => {
  it("has a row for every machine and no row for a machine that is gone", () => {
    const ids = ALL_MACHINES.map((m) => m.id).sort();
    expect(Object.keys(ROSTER).sort()).toEqual(ids);
  });

  it("names a capture trigger that the migration creates, on every table a machine reads", () => {
    let checked = 0;
    for (const machine of ALL_MACHINES) {
      const row = ROSTER[machine.id];
      expect(row.capture.length, `${machine.id} names no capture trigger`).toBeGreaterThan(0);
      for (const { table, trigger } of row.capture) {
        expect(triggers.has(`${trigger}@${table}`), `${machine.id}: ${trigger} on ${table} is not in the migration`).toBe(true);
      }
      const tables = new Set(row.capture.map((c) => c.table));
      for (const { table } of machine.db.columns) {
        expect(tables.has(table), `${machine.id} reads ${table} and nothing captures it`).toBe(true);
      }
      checked += 1;
    }
    console.log(`transition-records: ${checked} machines have a capture trigger`);
    expect(checked).toBeGreaterThan(0);
  });

  it("names where a person sees each move, or says why not", () => {
    let recorded = 0;
    let none = 0;
    for (const machine of ALL_MACHINES) {
      const activity = ROSTER[machine.id].activity;
      if ("recordActivity" in activity) {
        expect(activityKinds.has(activity.recordActivity), `${machine.id}: record_activity has no kind ${activity.recordActivity}`).toBe(true);
        recorded += 1;
      } else if ("auditLog" in activity) {
        const path = join(ROOT, activity.file);
        expect(existsSync(path), `${machine.id}: ${activity.file} does not exist`).toBe(true);
        const text = readFileSync(path, "utf8");
        expect(
          text.includes(`"${activity.auditLog}"`) || text.includes(`'${activity.auditLog}'`),
          `${machine.id}: ${activity.file} does not write ${activity.auditLog}`,
        ).toBe(true);
        recorded += 1;
      } else {
        expect(activity.none.length, `${machine.id}: a none needs a reason`).toBeGreaterThan(20);
        none += 1;
      }
    }
    console.log(`transition-records: ${recorded} machines leave an activity row, ${none} are PostHog only`);
    expect(recorded + none).toBe(ALL_MACHINES.length);
    expect(recorded).toBeGreaterThan(0);
  });

  it("keeps the generated edge list equal to the definitions", () => {
    const body = /from \(values([\s\S]*?)\) e\(machine, from_state, to_state\)/.exec(migration);
    expect(body, "the edge list is missing from the migration").not.toBeNull();
    const inMigration = new Set(
      [...body![1].matchAll(/\('(\w+)', (null::text|'[\w-]+'), '([\w-]+)'\)/g)].map(
        (m) => `${m[1]}|${m[2] === "null::text" ? "" : m[2].slice(1, -1)}|${m[3]}`,
      ),
    );
    const fromDefinitions = new Set<string>();
    for (const machine of ALL_MACHINES) {
      for (const to of machine.initial) fromDefinitions.add(`${machine.id}||${to}`);
      for (const [from, tos] of Object.entries(machine.transitions) as [string, readonly string[]][]) {
        for (const to of tos) fromDefinitions.add(`${machine.id}|${from}|${to}`);
      }
    }
    expect(fromDefinitions.size).toBeGreaterThan(0);
    expect([...inMigration].sort()).toEqual([...fromDefinitions].sort());
  });

  it("registers its suite with the SQL runner", () => {
    expect(existsSync(join(ROOT, "supabase", "tests", "state_transition_capture.test.sql"))).toBe(true);
    expect(readFileSync(join(ROOT, "scripts", "db-test-all.mjs"), "utf8")).toContain('"state_transition_capture"');
    expect(readdirSync(MIGRATIONS).includes(CAPTURE_MIGRATION.split("/").pop()!)).toBe(true);
  });
});
