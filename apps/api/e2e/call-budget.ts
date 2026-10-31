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
 * only, never a number, a leg id or a body. In GitHub Actions each one is also
 * a row of a table on the job's summary page, so the cost of a run is readable
 * without opening the log.
 */
import { appendFileSync, readFileSync } from "node:fs";
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

export type CallBudgetLayer = "session" | "e2e";

const SUMMARY_COLUMNS = [
  "Journey",
  "Rig scenario",
  "Dials",
  "Far-end legs",
  "Rig dials",
  "Peak legs",
  "Peak outbound legs",
  "Budget",
] as const;

/** The heading and header row of one layer's table. */
export function callBudgetSummaryHeader(layer: CallBudgetLayer): string {
  const align = SUMMARY_COLUMNS.map((_, i) => (i >= 2 && i <= 6 ? " ---: " : " --- "));
  return (
    `\n### Call journey budget (${layer} layer)\n\n` +
    `| ${SUMMARY_COLUMNS.join(" | ")} |\n` +
    `|${align.join("|")}|\n`
  );
}

/**
 * One journey's row. A count that differs from the committed file shows both,
 * so a red run's summary says which number moved.
 */
export function callBudgetSummaryRow(
  journey: string,
  budget: JourneyBudget,
  committed: JourneyBudget | undefined,
): string {
  const cell = (key: keyof Omit<JourneyBudget, "rig_scenario">) =>
    committed === undefined || committed[key] === budget[key]
      ? String(budget[key])
      : `${budget[key]} (budget ${committed[key]})`;
  const rigDials = budget.dials + budget.far_end_legs;
  const committedRigDials =
    committed === undefined ? rigDials : committed.dials + committed.far_end_legs;
  const verdict =
    committed === undefined
      ? "not in call-journey-budget.json"
      : JSON.stringify(committed) === JSON.stringify(budget)
        ? "matches"
        : "differs";
  return (
    `| ${[
      journey,
      budget.rig_scenario,
      cell("dials"),
      cell("far_end_legs"),
      rigDials === committedRigDials ? String(rigDials) : `${rigDials} (budget ${committedRigDials})`,
      cell("peak_concurrent_legs"),
      cell("peak_concurrent_outbound_legs"),
      verdict,
    ].join(" | ")} |\n`
  );
}

/** Layers whose table header this process has already written. */
const summarizedLayers = new Set<CallBudgetLayer>();

/**
 * Append one journey's row to the summary file at `summaryPath`, starting the
 * layer's table on its first row. Does nothing without a path, which is the
 * case outside Actions. Every journey of a layer runs in one test file, and so
 * in one process, so each layer gets one table.
 *
 * No default path: `undefined` means no summary, never the job's real one.
 */
export function appendCallBudgetSummary(
  journey: string,
  layer: CallBudgetLayer,
  budget: JourneyBudget,
  summaryPath: string | undefined,
): boolean {
  if (summaryPath === undefined || summaryPath === "") return false;
  const committed = committedBudgets()[journey];
  const header = summarizedLayers.has(layer) ? "" : callBudgetSummaryHeader(layer);
  appendFileSync(summaryPath, header + callBudgetSummaryRow(journey, budget, committed));
  summarizedLayers.add(layer);
  return true;
}

/** Forget which tables were started, so a test can write a fresh one. */
export function resetCallBudgetSummaryForTest(): void {
  summarizedLayers.clear();
}

/**
 * Print one journey's numbers. `layer` says which harness measured them:
 * `session` runs the router and the Durable Object with the database faked,
 * `e2e` goes through the whole Worker and a real database.
 */
export function emitCallBudget(
  journey: string,
  layer: CallBudgetLayer,
  budget: JourneyBudget,
): void {
  appendCallBudgetSummary(journey, layer, budget, process.env.GITHUB_STEP_SUMMARY);
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
