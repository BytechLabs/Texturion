import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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
 * The API's own Sentry SDK, as apps/api resolves it, so the events below are
 * the exceptions Sentry sends for a thrown error rather than a guess at them.
 */
const apiRequire = createRequire(join(TOOLING_ROOT, "apps", "api", "package.json"));
const sentry = createRequire(apiRequire.resolve("@sentry/cloudflare"))("@sentry/core");

/** What the default linked-errors integration makes of `error`, outermost last. */
function sentryEvent(error) {
  const stackParser = sentry.createStackParser();
  const event = { exception: { values: [sentry.exceptionFromError(stackParser, error)] } };
  sentry.linkedErrorsIntegration().preprocessEvent(event, { originalException: error }, { getOptions: () => ({ stackParser }) });
  return { level: "error", exceptions: event.exception.values.map(({ type, value }) => ({ type, value })) };
}

function telnyxError(message) {
  const error = new Error(message);
  error.name = "TelnyxApiError";
  return error;
}
const refused = (method, path) => telnyxError(`Telnyx 403 on ${method} ${path} [codes rig_endpoint_refused]`);
/** A cron's failure as runScheduledJobs throws it, one job failing with `failure`. */
const cronFailure = (cron, failure) => new AggregateError([failure], `cron "${cron}": 1 of 1 job(s) failed`);

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

test("a job-fails refusal under the job's own AggregateError is expected", () => {
  const event = {
    exceptions: [
      { type: "TelnyxApiError", value: "Telnyx 403 on GET /v2/porting_orders/stub [codes rig_endpoint_refused]" },
      aggregate("port reconcile finished with 1 failure(s)"),
      aggregate('cron "10 13 * * *": 1 of 1 job(s) failed'),
    ],
  };
  assert.deepEqual(explainer.explain(event), { kind: "expected" });
});

test("each job that collects its failures gets its refusals explained, as Sentry sends them", () => {
  const port = new AggregateError([refused("GET", "/v2/porting_orders/stub")], "port reconcile finished with 1 failure(s)");
  const sent = sentryEvent(cronFailure("10 13 * * *", port));
  assert.deepEqual(
    sent.exceptions.map((exception) => exception.type),
    ["TelnyxApiError", "AggregateError", "AggregateError"],
    "Sentry lists the cron's AggregateError last",
  );
  assert.deepEqual(explainer.explain(sent), { kind: "expected" });

  const brands = ["/v2/10dlc/brand/a", "/v2/10dlc/brand/b", "/v2/10dlc/campaign/c", "/v2/10dlc/campaign/d", "/v2/10dlc/campaign/e", "/v2/10dlc/brand/f", "/v2/10dlc/brand/g"];
  const poll = new AggregateError(
    brands.map((path) => refused("GET", path)),
    `registration poll finished with ${brands.length} failure(s)`,
  );
  const wide = sentryEvent(cronFailure("0 13 * * *", poll));
  assert.equal(wide.exceptions.length, brands.length + 2, "a job's failures are all listed, however many");
  assert.deepEqual(explainer.explain(wide), { kind: "expected" });

  const release = (paths) =>
    new AggregateError(
      paths.map((path) => refused("DELETE", path)),
      `number release failed for ${paths.length} of ${paths.length} numbers`,
    );
  const grace = new AggregateError(
    [release(["/v2/messaging_hosted_numbers/a"]), release(["/v2/messaging_hosted_numbers/b"])],
    "grace job failed for 2 companies",
  );
  assert.deepEqual(explainer.explain(sentryEvent(cronFailure("0 14 * * *", grace))), { kind: "expected" });
});

test("the same refusal inside a failure that is not a cron's is not explained", () => {
  const port = new AggregateError([refused("GET", "/v2/porting_orders/stub")], "port reconcile finished with 1 failure(s)");
  assert.equal(explainer.explain(sentryEvent(port)), undefined);
  assert.equal(explainer.explain(sentryEvent(cronFailure("*/5 * * * *", port))), undefined, "a cron that lists no such refusal");
  const beside = new AggregateError([port, new Error("relation \"port_requests\" does not exist")], 'cron "10 13 * * *": 2 of 2 job(s) failed');
  assert.equal(explainer.explain(sentryEvent(beside)), undefined);
});

test("a failure Sentry never read inside leaves the event unexplained", () => {
  // Sentry stops reading inside a chain once it has listed six exceptions,
  // and still lists the siblings it is looping over, so the second release
  // below is listed and its real failure is not.
  const release = (failures, size) => new AggregateError(failures, `number release failed for ${failures.length} of ${size} numbers`);
  const firstCompany = release(
    ["a", "b", "c"].map((id) => refused("DELETE", `/v2/messaging_hosted_numbers/${id}`)),
    3,
  );
  const real = telnyxError("Telnyx 500 on DELETE /v2/messaging_hosted_numbers/d");
  const grace = new AggregateError([firstCompany, release([real], 1)], "grace job failed for 2 companies");
  const sent = sentryEvent(cronFailure("0 14 * * *", grace));
  assert.ok(!sent.exceptions.some((exception) => exception.value === real.message), "Sentry dropped the real failure");
  assert.ok(sent.exceptions.filter((exception) => exception.type !== "AggregateError").every((exception) => exception.value.includes("[codes rig_endpoint_refused]")));
  assert.equal(explainer.explain(sent), undefined);
});

test("a skip's fingerprints are expected, and nothing else is", () => {
  const skipping = cronExplainer(
    JSON.stringify({
      schema: registry.schema,
      refusal_match: registry.refusal_match,
      crons: [
        {
          config: "apps/api/wrangler.jsonc",
          cron: "0 9 * * *",
          class: "skip",
          reason: "x",
          fingerprints: [
            ["ops", "cron:0 9 * * *"],
            ["ops", "job:stub-job"],
          ],
        },
      ],
    }),
  );
  assert.deepEqual(skipping.explain({ fingerprint: ["ops", "job:stub-job"] }), { kind: "expected" });
  assert.deepEqual(skipping.explain({ fingerprint: ["ops", "cron:0 9 * * *"] }), { kind: "expected" });
  assert.equal(skipping.explain({ fingerprint: ["ops", "job:other"] }), undefined);
  assert.equal(skipping.explain({ fingerprint: ["ops"] }), undefined);
});
