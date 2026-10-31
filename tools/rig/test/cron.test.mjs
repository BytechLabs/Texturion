import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  cronTimers,
  cronToOnCalendar,
  cronsToSchedule,
  cronUnits,
  fireCron,
  readCronRegistry,
  scheduledMinute,
  scheduledUrl,
} from "../src/cron.mjs";
import { parseJsonc } from "../src/jsonc.mjs";
import { TOOLING_ROOT } from "../src/layout.mjs";

test("every cron the API declares converts to an OnCalendar in UTC", () => {
  const { crons } = parseJsonc(readFileSync(join(TOOLING_ROOT, "apps", "api", "wrangler.jsonc"), "utf8")).triggers;
  assert.ok(crons.length > 10);
  for (const cron of crons) assert.match(cronToOnCalendar(cron), / UTC$/, cron);
});

test("cron fields map onto systemd's calendar", () => {
  assert.equal(cronToOnCalendar("* * * * *"), "*-*-* *:*:00 UTC");
  assert.equal(cronToOnCalendar("*/5 * * * *"), "*-*-* *:00/5:00 UTC");
  assert.equal(cronToOnCalendar("15 */6 * * *"), "*-*-* 00/6:15:00 UTC");
  assert.equal(cronToOnCalendar("0 13 * * *"), "*-*-* 13:00:00 UTC");
  assert.equal(cronToOnCalendar("50 13 * * 1"), "Mon *-*-* 13:50:00 UTC");
  assert.equal(cronToOnCalendar("35 14 1 * *"), "*-*-01 14:35:00 UTC");
  assert.equal(cronToOnCalendar("0 9 * * 1-5"), "Mon..Fri *-*-* 09:00:00 UTC");
  assert.equal(cronToOnCalendar("0,30 * * * *"), "*-*-* *:00,30:00 UTC");
});

test("crons systemd would read differently are refused", () => {
  assert.throws(() => cronToOnCalendar("0 0 1 * 1"), /both days/);
  assert.throws(() => cronToOnCalendar("0-30/5 * * * *"), /stepped range/);
  assert.throws(() => cronToOnCalendar("61 * * * *"), /out of range/);
  assert.throws(() => cronToOnCalendar("* * * *"), /five fields/);
});

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

test("only classified crons get a timer, and a skip gets none", () => {
  const crons = ["* * * * *", "0 13 * * *", "10 13 * * *"];
  const registry = [
    { cron: "* * * * *", class: "run" },
    { cron: "0 13 * * *", class: "run-expect-refusal" },
  ];
  assert.deepEqual(cronsToSchedule(crons, registry), {
    schedule: ["* * * * *", "0 13 * * *"],
    unclassified: ["10 13 * * *"],
    skipped: [],
  });
  const withSkip = { crons: [...registry, { config: "apps/api/wrangler.jsonc", cron: "10 13 * * *", class: "skip" }] };
  assert.deepEqual(cronsToSchedule(crons, withSkip).skipped, ["10 13 * * *"]);
  assert.deepEqual(cronsToSchedule(crons, withSkip).unclassified, []);
});

test("a missing or unreadable registry is refused, never read as no crons", () => {
  const crons = ["* * * * *"];
  assert.throws(() => cronsToSchedule(crons, null), /crons\.json is missing/);
  assert.throws(() => cronsToSchedule(crons, { "* * * * *": "run" }), /no list of crons/);
  assert.throws(() => cronsToSchedule(crons, { crons: [{ expr: "* * * * *", kind: "run" }] }), /no cron or no class/);
  assert.throws(
    () => cronsToSchedule(crons, { crons: [{ config: "apps/web/wrangler.jsonc", cron: "* * * * *", class: "run" }] }),
    /classifies none of apps\/api\/wrangler\.jsonc's crons/,
  );
});

test("the registry on main classifies every cron the API declares", { skip: readCronRegistry() === null ? "tools/rig/crons.json is not on this branch" : false }, () => {
  const { crons } = parseJsonc(readFileSync(join(TOOLING_ROOT, "apps", "api", "wrangler.jsonc"), "utf8")).triggers;
  assert.deepEqual(cronsToSchedule(crons, readCronRegistry()).unclassified, []);
});

test("each scheduled cron gets its own timer unit", () => {
  assert.deepEqual(cronTimers(["* * * * *", "0 13 * * *"]), [
    { cron: "* * * * *", slug: "c00", timer: "loonext-rig-cron-c00.timer" },
    { cron: "0 13 * * *", slug: "c01", timer: "loonext-rig-cron-c01.timer" },
  ]);
});

test("a timer unit quotes the cron and fires the rig CLI", () => {
  const units = cronUnits({ cron: "*/5 * * * *", slug: "c01", node: "/usr/bin/node", rigBin: "/opt/rig/tools/rig/bin/rig.mjs" });
  assert.match(units.service, /^ExecStart=\/usr\/bin\/node \/opt\/rig\/tools\/rig\/bin\/rig\.mjs cron "\*\/5 \* \* \* \*"$/m);
  assert.match(units.timer, /^OnCalendar=\*-\*-\* \*:00\/5:00 UTC$/m);
  assert.match(units.timer, /^Unit=loonext-rig-cron-c01\.service$/m);
});
