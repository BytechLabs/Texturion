/**
 * R00's exceptions half, read when `rig health` asks (tools/rig/src/health.mjs)
 * and on no timer: the local API's last day of `rig` exceptions in PostHog,
 * each explained by the cron registry or by a G01 attempt, or left
 * unexplained.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SecretFiles } from "@loonext/rig-robot";
import { cronExplainer, type CronExplainer } from "./cron-events.ts";
import { openJournals, type LeaseClient } from "./lease.ts";
import { posthogFromStore, reportApiExceptions, type ApiExceptionsReport, type Explanation, type SeenEvent } from "./posthog-errors.ts";
import { g01Refusal } from "./scenarios/gates.ts";
import { VerdictStore } from "./verdicts.ts";

const CRON_REGISTRY = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "crons.json");

/**
 * How R00 explains a local API event: the cron registry first, then a G01
 * attempt's refusals. An attempt still holding its lease counts from when it
 * took it, so its refusals are expected before its verdict is written.
 */
export function exceptionExplain(
  explainer: CronExplainer | undefined,
  verdicts: Pick<VerdictStore, "all">,
  leases: Pick<LeaseClient, "open">,
  now: number,
): (event: SeenEvent) => Explanation | undefined {
  const g01 = [
    ...verdicts.all().filter((v) => v.scenario === "G01"),
    ...leases
      .open()
      .filter((entry) => entry.scenario === "G01")
      .map((entry) => ({ started_at: new Date(entry.acquired_at).toISOString(), finished_at: new Date(now).toISOString() })),
  ];
  return (event) => explainer?.explain(event) ?? (g01Refusal(event, g01) ? { kind: "expected" } : undefined);
}

/** A registry that does not parse explains nothing here; R00's crons check fails on it. */
function registryExplainer(): CronExplainer | undefined {
  try {
    return cronExplainer(existsSync(CRON_REGISTRY) ? readFileSync(CRON_REGISTRY, "utf8") : undefined);
  } catch {
    return undefined;
  }
}

/** The report of the last day's exceptions, from the rig's `state/` and its store. */
export async function apiExceptionsNow(
  sources: { stateDir: string; store: Pick<SecretFiles, "readOptional"> },
  now = Date.now(),
): Promise<ApiExceptionsReport> {
  const rigd = join(sources.stateDir, "rigd");
  const verdicts = new VerdictStore(join(rigd, "verdicts"));
  const leases = { open: () => openJournals(join(rigd, "leases")) };
  return reportApiExceptions(posthogFromStore(sources.store), exceptionExplain(registryExplainer(), verdicts, leases, now), now);
}
