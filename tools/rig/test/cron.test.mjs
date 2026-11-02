import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { classifyCrons, fireCron, readCronRegistry, resolveCron, scheduledMinute, scheduledUrl } from "../src/cron.mjs";
import { parseJsonc } from "../src/jsonc.mjs";
import { TOOLING_ROOT } from "../src/layout.mjs";

test("the scheduled time is the minute, as Cloudflare passes it", () => {
  assert.equal(scheduledMinute(Date.UTC(2026, 9, 31, 4, 5, 59, 999)), Date.UTC(2026, 9, 31, 4, 5));
  assert.equal(
    scheduledUrl("http://127.0.0.1:8787", "/cdn-cgi/handler/scheduled", "*/5 * * * *", 1),
    "http://127.0.0.1:8787/cdn-cgi/handler/scheduled?cron=*%2F5+*+*+*+*&time=1",
  );
});

test("a 404 on the cdn-cgi route falls back to /__scheduled", async () => {
  const seen = [];
  const fake = async (url) => {
    seen.push(new URL(url).pathname);
    return new Response("ok", { status: seen.length === 1 ? 404 : 200 });
  };
  const result = await fireCron("http://127.0.0.1:1", "* * * * *", 0, fake);
  assert.deepEqual(seen, ["/cdn-cgi/handler/scheduled", "/__scheduled"]);
  assert.equal(result.route, "/__scheduled");
  assert.equal(result.status, 200);
  // /__scheduled runs the job at the wall clock whatever `time` says.
  assert.equal(result.timeHonored, false);

  const failing = await fireCron("http://127.0.0.1:1", "* * * * *", 0, async () => new Response("boom", { status: 500 }));
  assert.equal(failing.route, "/cdn-cgi/handler/scheduled");
  assert.equal(failing.status, 500);
  assert.equal(failing.timeHonored, true);
});

test("only classified crons can be fired, and a skip is never fired", () => {
  const crons = ["* * * * *", "0 13 * * *", "10 13 * * *"];
  const registry = [
    { cron: "* * * * *", class: "run" },
    { cron: "0 13 * * *", class: "run-expect-refusal" },
  ];
  assert.deepEqual(classifyCrons(crons, registry), {
    fire: ["* * * * *", "0 13 * * *"],
    unclassified: ["10 13 * * *"],
    skipped: [],
  });
  const withSkip = { crons: [...registry, { config: "apps/api/wrangler.jsonc", cron: "10 13 * * *", class: "skip" }] };
  assert.deepEqual(classifyCrons(crons, withSkip).skipped, ["10 13 * * *"]);
  assert.deepEqual(classifyCrons(crons, withSkip).unclassified, []);
});

test("a missing or unreadable registry is refused, never read as no crons", () => {
  const crons = ["* * * * *"];
  assert.throws(() => classifyCrons(crons, null), /crons\.json is missing/);
  assert.throws(() => classifyCrons(crons, { "* * * * *": "run" }), /no list of crons/);
  assert.throws(() => classifyCrons(crons, { crons: [{ expr: "* * * * *", kind: "run" }] }), /no cron or no class/);
  assert.throws(
    () => classifyCrons(crons, { crons: [{ config: "apps/web/wrangler.jsonc", cron: "* * * * *", class: "run" }] }),
    /classifies none of apps\/api\/wrangler\.jsonc's crons/,
  );
});

test("the registry on main classifies every cron the API declares", { skip: readCronRegistry() === null ? "tools/rig/crons.json is not on this branch" : false }, () => {
  const { crons } = parseJsonc(readFileSync(join(TOOLING_ROOT, "apps", "api", "wrangler.jsonc"), "utf8")).triggers;
  assert.deepEqual(classifyCrons(crons, readCronRegistry()).unclassified, []);
});

test("a cron is named by its expression or by a job it runs", () => {
  const registry = {
    crons: [
      { config: "apps/api/wrangler.jsonc", cron: "* * * * *", class: "run", jobs: ["job:lead-chase", "job:scheduled-send"] },
      { config: "apps/api/wrangler.jsonc", cron: "*/5 * * * *", class: "run", jobs: ["job:sweep-webhooks", "job:shared"] },
      { config: "apps/api/wrangler.jsonc", cron: "0 * * * *", class: "run", jobs: ["job:shared"] },
      { config: "tools/edge/wrangler.jsonc", cron: "*/15 * * * *", class: "skip", jobs: ["job:lead-chase"] },
    ],
  };
  assert.equal(resolveCron("*/5 * * * *", registry), "*/5 * * * *");
  assert.equal(resolveCron("job:lead-chase", registry), "* * * * *");
  assert.equal(resolveCron("job:sweep-webhooks", registry), "*/5 * * * *");
  assert.throws(() => resolveCron("job:nobody", registry), /no cron in tools\/rig\/crons\.json runs job:nobody/);
  assert.throws(() => resolveCron("job:shared", registry), /runs under 2 crons.*name the expression/);
  assert.throws(() => resolveCron("job:lead-chase", null), /no list of crons/);
});

test("every job the registry lists resolves to a cron the API declares", { skip: readCronRegistry() === null ? "tools/rig/crons.json is not on this branch" : false }, () => {
  const registry = readCronRegistry();
  const { crons } = parseJsonc(readFileSync(join(TOOLING_ROOT, "apps", "api", "wrangler.jsonc"), "utf8")).triggers;
  const jobs = registry.crons.filter((entry) => entry.config === "apps/api/wrangler.jsonc").flatMap((entry) => entry.jobs ?? []);
  assert.ok(jobs.length > 10);
  for (const job of new Set(jobs)) {
    let cron;
    try {
      cron = resolveCron(job, registry);
    } catch (error) {
      // A job two crons run is named by its expression; that refusal is the point.
      assert.match(error.message, /runs under \d+ crons/, job);
      continue;
    }
    assert.ok(crons.includes(cron), `${job} resolves to ${cron}, which the API does not declare`);
  }
});
