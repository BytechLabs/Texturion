import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { TOOLING_ROOT } from "../src/layout.mjs";

/**
 * tools/rig/crons.json read by rigd's own explainer, the one R00 and
 * `rig health` report through, under Node's type stripping as on the rig.
 *
 * The events are shaped as the API sends them to PostHog: runScheduledJobs
 * reports each failure a job lets out, one exception per failure, with the
 * cron and the job beside it, and PostHog lists a chain's outermost exception
 * last.
 */
const { cronExplainer } = await import(pathToFileURL(join(TOOLING_ROOT, "tools", "rig", "rigd", "src", "cron-events.ts")).href);
const registryText = readFileSync(join(TOOLING_ROOT, "tools", "rig", "crons.json"), "utf8");
const registry = JSON.parse(registryText);
const explainer = cronExplainer(registryText);

const refusedDelete = { type: "TelnyxApiError", value: "Telnyx 403 on DELETE /v2/phone_numbers/stub-number-id" };
const refused = (method, path) => ({ type: "TelnyxApiError", value: `Telnyx 403 on ${method} ${path} [codes rig_endpoint_refused]` });
/** One failure a job let out on `cron`, as runScheduledJobs reports it. */
const jobFailure = (cron, job, ...exceptions) => ({ level: "error", tags: { source: "cron", cron, job }, exceptions });

/** One event per defect, in each cron's order, shaped as the app raises it. */
const SAMPLES = {
  "*/15 * * * *": [
    { level: "warning", message: "reconcile: a Telnyx number is unknown to phone_numbers", tags: { source: "cron", job: "job:reconcile-numbers" } },
    // reconcileNumbers captures the refused DELETE on its own.
    { level: "error", tags: { source: "cron", job: "job:reconcile-numbers" }, exceptions: [refusedDelete] },
    // reconcileVoiceEnablement captures each refused bind, then counts them.
    { level: "error", exceptions: [{ type: "TelnyxApiError", value: "Telnyx 403 on PATCH /v2/phone_numbers/stub-number-id" }] },
    { level: "warning", message: "voice enablement reconcile: 3 number(s) still failing" },
    { level: "warning", message: "reconcile: reclaimed an orphaned Telnyx number a settled company owned and no row claims" },
  ],
  "0 14 * * *": [jobFailure("0 14 * * *", "job:grace-and-release", refusedDelete)],
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

test("the grace job's refused release is S29's defect, never the number sweep's", () => {
  const grace = registry.crons.find((entry) => entry.cron === "0 14 * * *").defects[0].means;
  assert.deepEqual(explainer.explain(jobFailure("0 14 * * *", "job:grace-and-release", refusedDelete)), { kind: "defect", means: grace });
  // The same refusal raised by a job no defect names is nobody's defect.
  assert.equal(explainer.explain(jobFailure("*/5 * * * *", "job:sweep-webhooks", refusedDelete)), undefined);
});

test("a captured refusal is expected", () => {
  const event = { level: "error", exceptions: [refused("POST", "/v2/10dlc/phoneNumberCampaign")] };
  assert.deepEqual(explainer.explain(event), { kind: "expected" });
});

test("a job-fails refusal is expected on the cron that lists it", () => {
  assert.deepEqual(explainer.explain(jobFailure("10 13 * * *", "job:poll-port-requests", refused("GET", "/v2/porting_orders/stub"))), {
    kind: "expected",
  });
  assert.deepEqual(explainer.explain(jobFailure("0 13 * * *", "job:poll-registrations", refused("GET", "/v2/10dlc/brand/a"))), {
    kind: "expected",
  });
  assert.deepEqual(
    explainer.explain(jobFailure("0 14 * * *", "job:grace-and-release", refused("DELETE", "/v2/messaging_hosted_numbers/a"))),
    { kind: "expected" },
  );
});

test("a job-fails refusal under an AggregateError of its own is still the refusal", () => {
  const event = jobFailure("10 13 * * *", "job:poll-port-requests", refused("GET", "/v2/porting_orders/stub"), {
    type: "AggregateError",
    value: "port reconcile finished with 1 failure(s)",
  });
  assert.deepEqual(explainer.explain(event), { kind: "expected" });
});

test("the same refusal is not explained where no refusal is listed, or beside a real failure", () => {
  // A brand read is refused only where the poll lets it out, never captured.
  const brand = refused("GET", "/v2/10dlc/brand/a");
  assert.equal(explainer.explain({ level: "error", exceptions: [brand] }), undefined, "no cron, and not a captured path");
  assert.equal(explainer.explain(jobFailure("*/5 * * * *", "job:sweep-webhooks", brand)), undefined, "a cron that lists no such refusal");
  const real = { type: "Error", value: 'relation "messaging_registrations" does not exist' };
  assert.equal(explainer.explain(jobFailure("0 13 * * *", "job:poll-registrations", real)), undefined);
  assert.equal(explainer.explain(jobFailure("0 13 * * *", "job:poll-registrations", brand, real)), undefined);
});

test("a job failure that carries no exception at all is not explained", () => {
  const event = jobFailure("10 13 * * *", "job:poll-port-requests", { type: "AggregateError", value: "port reconcile failed" });
  assert.equal(explainer.explain(event), undefined);
});

test("a skip explains nothing, since the rig never fires it", () => {
  const skipping = cronExplainer(
    JSON.stringify({
      schema: registry.schema,
      refusal_match: registry.refusal_match,
      crons: [{ config: "tools/edge/wrangler.jsonc", cron: "0 9 * * *", class: "skip", reason: "x" }],
    }),
  );
  assert.equal(skipping.explain({ fingerprint: ["ops", "job:stub-job"] }), undefined);
  assert.equal(skipping.explain({ tags: { cron: "0 9 * * *" }, exceptions: [refused("GET", "/v2/porting_orders/x")] }), undefined);
});
