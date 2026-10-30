/**
 * The dial counts the hermetic call journeys measure, and the committed copy
 * in call-journey-budget.json that docs/RIG.md's dial budget is computed from.
 *
 * The two must never drift: a change that adds a dial to a journey fails
 * until the file is updated in the same commit, where a reviewer sees the
 * cost.
 *
 * Every measurement is also printed on one `CALL_BUDGET ` line, the same
 * scrape-friendly shape as CAPACITY_RESULT in load-report.ts: aggregate counts
 * only, never a number, a leg id or a body.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { CallLedger, FakeVoice, TelnyxWebhookEvent } from "./fake-telnyx-voice";

export const CALL_BUDGET_PREFIX = "CALL_BUDGET ";

export const CALL_BUDGET_FILE = fileURLToPath(
  new URL("./call-journey-budget.json", import.meta.url),
);

export interface JourneyBudget {
  /** The docs/RIG.md scenario this journey is the hermetic twin of. */
  rig_scenario: string;
  dials: number;
  far_end_legs: number;
  peak_concurrent_legs: number;
  peak_concurrent_outbound_legs: number;
}

interface BudgetFile {
  schema: string;
  journeys: Record<string, JourneyBudget>;
}

export function committedBudgets(): Record<string, JourneyBudget> {
  const parsed = JSON.parse(readFileSync(CALL_BUDGET_FILE, "utf8")) as BudgetFile;
  if (parsed.schema !== "loonext.call-budget.v1") {
    throw new Error(`${CALL_BUDGET_FILE}: unknown schema ${parsed.schema}`);
  }
  return parsed.journeys;
}

export function committedBudget(journey: string): JourneyBudget {
  const budget = committedBudgets()[journey];
  if (!budget) {
    throw new Error(`${CALL_BUDGET_FILE} has no entry for journey "${journey}"`);
  }
  return budget;
}

/** The ledger in the committed file's shape, so the two compare whole. */
export function measuredBudget(rigScenario: string, ledger: CallLedger): JourneyBudget {
  return {
    rig_scenario: rigScenario,
    dials: ledger.dials,
    far_end_legs: ledger.farEndLegs,
    peak_concurrent_legs: ledger.peakConcurrentLegs,
    peak_concurrent_outbound_legs: ledger.peakConcurrentOutboundLegs,
  };
}

/**
 * Print one journey's numbers. `layer` says which harness measured them:
 * `session` runs the router and the Durable Object with the database faked,
 * `e2e` goes through the whole Worker and a real database.
 */
export function emitCallBudget(
  journey: string,
  layer: "session" | "e2e",
  budget: JourneyBudget,
): void {
  process.stdout.write(
    `${CALL_BUDGET_PREFIX}${JSON.stringify({
      schema: "loonext.call-budget.v1",
      journey,
      layer,
      ...budget,
      // On the rig a far-end leg is the robot dialling in, which Telnyx counts
      // as a dial on the same account.
      rig_dials: budget.dials + budget.far_end_legs,
    })}\n`,
  );
}

/**
 * Deliver the fake's webhooks one at a time, oldest first, letting every
 * session go idle between deliveries, until nothing is left to say.
 *
 * One at a time is deliberate. Telnyx does not promise order, but a journey
 * that delivered concurrently would be testing a race it chose at random,
 * and the count it reported would not reproduce.
 */
export async function drainCallEvents(
  voice: FakeVoice,
  deliver: (event: TelnyxWebhookEvent) => Promise<void>,
  idle: () => Promise<void>,
  limit = 200,
): Promise<number> {
  let delivered = 0;
  await idle();
  for (;;) {
    const event = voice.takeEvent();
    if (!event) {
      await idle();
      if (voice.pendingEvents() === 0) return delivered;
      continue;
    }
    await deliver(event);
    delivered += 1;
    await idle();
    if (delivered > limit) {
      throw new Error(
        `call events did not settle after ${limit} deliveries; the last was ${event.data.event_type}`,
      );
    }
  }
}
