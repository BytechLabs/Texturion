/** R00 checks local API exceptions in PostHog since this rig's deployment. */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SecretFiles } from "@loonext/rig-robot";
import { cronExplainer } from './cron-events.ts';
import type { CronExplainer } from './cron-events.ts';
import { openJournals } from './lease.ts';
import type { LeaseClient } from './lease.ts';
import { posthogFromStore, reportApiExceptions } from './posthog-errors.ts';
import type { ApiExceptionsReport, Explanation, SeenEvent } from './posthog-errors.ts';
import { expectedProbe, readProbes } from './probe-exceptions.ts';
import { g01Refusal } from "./scenarios/gates.ts";
import { VerdictStore } from "./verdicts.ts";

const CRON_REGISTRY = resolve(import.meta.dirname, "..", "..", "crons.json");

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

/** The report of exceptions since deployment, from the rig's `state/` and its store. */
export async function apiExceptionsNow(
  sources: { stateDir: string; store: Pick<SecretFiles, "readOptional"> },
  now = Date.now(),
): Promise<ApiExceptionsReport> {
  const rigd = join(sources.stateDir, "rigd");
  let deployedAt: number;
  try {
    const deployed = JSON.parse(readFileSync(join(sources.stateDir, "deployed.json"), "utf8")) as { at?: unknown };
    deployedAt = typeof deployed.at === "string" ? Date.parse(deployed.at) : Number.NaN;
  } catch {
    deployedAt = Number.NaN;
  }
  if (!Number.isFinite(deployedAt)) {
    return { at: new Date(now).toISOString(), error: "state/deployed.json has no valid deployment time; run rig deploy first", unexplained_since_deploy: [], defects_since_deploy: [] };
  }
  const verdicts = new VerdictStore(join(rigd, "verdicts"));
  const leases = { open: () => openJournals(join(rigd, "leases")) };
  const explain = exceptionExplain(registryExplainer(), verdicts, leases, now);
  const probes = readProbes(join(rigd, "expected-probe-exceptions.json"));
  return reportApiExceptions(posthogFromStore(sources.store), (event) => explain(event) ?? expectedProbe(event, probes), now, deployedAt);
}
