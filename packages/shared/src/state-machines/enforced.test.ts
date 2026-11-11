/**
 * #722 phase 2: a machine the database enforces with a transition trigger
 * allows exactly the moves its shared definition allows. The trigger is read
 * from the migration that defines it, so changing one without the other fails.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { dataExportMachine } from "./data-export";
import { messageMachine } from "./message";
import { paymentRequestMachine } from "./payment-request";
import { quoteMachine } from "./quote";
import { scheduledMessageMachine } from "./scheduled-message";
import { webhookDeliveryMachine } from "./webhook-delivery";

const MIGRATIONS = join(__dirname, "..", "..", "..", "..", "supabase", "migrations");

/** The `old.status = 'x' and new.status in (...)` pairs in a guard function. */
function triggerEdges(file: string, fn: string): Map<string, string[]> {
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const start = sql.indexOf(`function public.${fn}()`);
  const body = sql.slice(start, sql.indexOf("$$;", start));
  const edges = new Map<string, string[]>();
  for (const match of body.matchAll(/old\.status = '(\w+)' and new\.status in \(([^)]*)\)/g)) {
    edges.set(
      match[1]!,
      [...match[2]!.matchAll(/'(\w+)'/g)].map((m) => m[1]!).sort(),
    );
  }
  return edges;
}

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
  ] as const)("%s: the trigger allows exactly the defined moves", (_name, machine, fn) => {
    const edges = triggerEdges(
      "20261111320000_payments_quotes_exports_and_webhooks_keep_their_lifecycles.sql",
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
});
