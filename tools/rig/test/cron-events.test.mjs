import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { TOOLING_ROOT } from "../src/layout.mjs";

/**
 * tools/rig/crons.json read by rigd's own explainer, the one R00 and
 * `rig health` report through, under Node's type stripping as on the rig.
 */
const { cronExplainer } = await import(pathToFileURL(join(TOOLING_ROOT, "tools", "rig", "rigd", "src", "cron-events.ts")).href);
const registryText = readFileSync(join(TOOLING_ROOT, "tools", "rig", "crons.json"), "utf8");
const registry = JSON.parse(registryText);
const explainer = cronExplainer(registryText);

const refusedDelete = { type: "TelnyxApiError", value: "Telnyx 403 on DELETE /v2/phone_numbers/stub-number-id" };
const aggregate = (value) => ({ type: "AggregateError", value });

/**
 * One event per defect, in each cron's order, shaped as the app raises it.
 * Sentry lists a chain's outermost exception last.
 */
const SAMPLES = {
  "*/15 * * * *": [
    { level: "warning", message: "reconcile: Telnyx number stub-number-id (customer_reference=none) is unknown to phone_numbers" },
    // reconcileNumbers captures the refused DELETE on its own.
    { level: "error", exceptions: [refusedDelete] },
    { level: "warning", message: "reconcile: reclaimed orphaned Telnyx number stub-number-id (customer_reference=stub-company) - x" },
  ],
  "0 14 * * *": [
    // releaseCompanyNumbers, then the grace job, then runScheduledJobs.
    {
      level: "error",
      exceptions: [
        refusedDelete,
        aggregate("number release failed for 1 of 1 numbers"),
        aggregate("grace job failed for 1 company"),
        aggregate('cron "0 14 * * *": 1 of 1 job(s) failed'),
      ],
    },
  ],
};

test("rigd reads every match in the registry", () => {
  assert.deepEqual(explainer.unread, []);
});

test("each defect's event is reported with its own cause, not an earlier defect's", () => {
  const defects = registry.crons.flatMap((entry) => (entry.defects ?? []).map((defect, i) => ({ cron: entry.cron, i, means: defect.means })));
  assert.ok(defects.length > 0);
  for (const { cron, i, means } of defects) {
    const event = SAMPLES[cron]?.[i];
    assert.ok(event, `crons.json "${cron}" defects[${i}] has no sample event here; add the event the app raises`);
    assert.deepEqual(explainer.explain(event), { kind: "defect", means }, `"${cron}" defects[${i}]`);
  }
  assert.equal(Object.values(SAMPLES).flat().length, defects.length, "a sample here names a defect the registry no longer has");
});

test("the grace job's refused release is S29's defect whatever wraps it, never the number sweep's", () => {
  const grace = registry.crons.find((entry) => entry.cron === "0 14 * * *").defects[0].means;
  const flat = { exceptions: [refusedDelete, aggregate('cron "0 14 * * *": 1 of 1 job(s) failed')] };
  assert.deepEqual(explainer.explain(flat), { kind: "defect", means: grace });
  // The same refusal inside another cron's failure is neither cron's defect.
  const elsewhere = { exceptions: [refusedDelete, aggregate('cron "*/15 * * * *": 1 of 9 job(s) failed')] };
  assert.equal(explainer.explain(elsewhere), undefined);
});

test("a captured refusal is expected", () => {
  const event = {
    level: "error",
    exceptions: [{ type: "TelnyxApiError", value: "Telnyx 403 on POST /v2/10dlc/phoneNumberCampaign [codes rig_endpoint_refused]" }],
  };
  assert.deepEqual(explainer.explain(event), { kind: "expected" });
});

test(
  "a job-fails refusal under the job's own AggregateError is expected",
  { todo: "rigd's explain() reads the first AggregateError as the cron's, and counts the job's own as a failure" },
  () => {
    const event = {
      exceptions: [
        { type: "TelnyxApiError", value: "Telnyx 403 on GET /v2/porting_orders/stub [codes rig_endpoint_refused]" },
        aggregate("port reconcile finished with 1 failure(s)"),
        aggregate('cron "10 13 * * *": 1 of 1 job(s) failed'),
      ],
    };
    assert.deepEqual(explainer.explain(event), { kind: "expected" });
  },
);
