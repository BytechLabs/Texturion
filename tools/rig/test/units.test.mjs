import assert from "node:assert/strict";
import { test } from "node:test";

import { forwardAiRun } from "../ai-shim/src/forward.mjs";
import { bootstrapSql, judgePosture } from "../src/bootstrap-db.mjs";
import { parseArgs } from "../src/cli.mjs";
import { webBuildArgs } from "../src/deploy.mjs";
import { nodeOffsetMinutes, tzMismatches, tzProbeSql } from "../src/health.mjs";
import { DEFAULT_SETTINGS, rigLayout } from "../src/layout.mjs";
import { CLOUDFLARE_CREDENTIALS, serveArgs, workerEnv } from "../src/serve.mjs";
import { parseLocalStatus, pinnedCliVersion, schemaPlan } from "../src/supabase.mjs";
import { startStubGuard, STUB_TOKEN } from "./support/stub-guard.mjs";

test("the AI shim posts the inputs to the guard's AI route with the caller token", async () => {
  const guard = await startStubGuard({ aiAnswer: (model, inputs) => ({ model, echoed: inputs }) });
  try {
    const url = `${guard.origin}/g/ai`;
    const answer = await forwardAiRun({ url, token: STUB_TOKEN, fetch }, "@cf/meta/llama-3.2-1b-instruct", { prompt: "hi" });
    assert.deepEqual(answer, { model: "@cf/meta/llama-3.2-1b-instruct", echoed: { prompt: "hi" } });
    assert.equal(guard.requests[0].path, "/g/ai/run/@cf/meta/llama-3.2-1b-instruct");
    assert.equal(guard.requests[0].authorization, `Bearer ${STUB_TOKEN}`);

    await assert.rejects(
      forwardAiRun({ url, token: "wrong", fetch }, "@cf/meta/llama-3.2-1b-instruct", {}),
      /the guard refused \(403: class\.not_allowed\)/,
    );
    await assert.rejects(forwardAiRun({ url, token: STUB_TOKEN, fetch }, "../admin", {}), /not a Workers AI model id/);
    await assert.rejects(
      forwardAiRun({ url, token: STUB_TOKEN, fetch }, "@cf/meta/x", {}, { gateway: { id: "g" } }),
      /options are not forwarded/,
    );
  } finally {
    await guard.close();
  }
});

test("bootstrap SQL takes E.164 only and refuses an empty list", () => {
  assert.equal(
    bootstrapSql(["+14165550100", "+14165550101"]),
    "alter database postgres set loonext.deploy_env = 'rig';\n" +
      "alter database postgres set loonext.rig_endpoints = '+14165550100,+14165550101';",
  );
  assert.throws(() => bootstrapSql([]), /no endpoints/);
  assert.throws(() => bootstrapSql(["+14165550100'; drop table x; --"]), /not E\.164/);
});

test("the posture passes only when every read says rig with every endpoint", () => {
  assert.equal(judgePosture([{ deploy_env: "rig", endpoints: 7 }, { deploy_env: "rig", endpoints: 7 }], 7), null);
  assert.match(judgePosture([{ deploy_env: "rig", endpoints: 7 }, { deploy_env: "", endpoints: 0 }], 7), /not rig/);
  assert.match(judgePosture([{ deploy_env: "rig", endpoints: 6 }], 7), /6 endpoint/);
});

test("migrate only when the database's history is a prefix of the ref's", () => {
  assert.equal(schemaPlan(["1", "2"], ["1", "2", "3"]).action, "migrate");
  assert.deepEqual(schemaPlan(["1", "2"], ["1", "2", "3"]).pending, ["3"]);
  assert.equal(schemaPlan(["1", "2"], ["1", "2"]).action, "none");
  assert.equal(schemaPlan(["1", "2", "3"], ["1", "2"]).action, "reset");
  assert.equal(schemaPlan(["1", "4"], ["1", "2", "3"]).action, "reset");
  assert.equal(schemaPlan(null, ["1"]).action, "reset");
  assert.equal(schemaPlan([], ["1"]).action, "reset");
});

test("the Supabase CLI version comes from CI's own pin", () => {
  assert.match(pinnedCliVersion(), /^\d+\.\d+\.\d+$/);
});

test("old Next majors get the rig-only unsupported-version flag", () => {
  assert.ok(webBuildArgs({ dependencies: { next: "^15.5.0" } }).includes("--dangerouslyUseUnsupportedNextVersion"));
  assert.ok(!webBuildArgs({ dependencies: { next: "^16.4.3" } }).includes("--dangerouslyUseUnsupportedNextVersion"));
});

test("the API unit runs both configs, rig vars, loopback only, and the scheduled fallback", () => {
  const layout = rigLayout({ RIG_HOME: "/var/lib/loonext-rig" });
  const { args } = serveArgs("api", { root: "/w", layout, settings: DEFAULT_SETTINGS });
  const pairs = (flag) => args.flatMap((arg, i) => (arg === flag ? [args[i + 1]] : []));
  assert.deepEqual(pairs("--config")[0], "wrangler.rig.jsonc");
  assert.match(pairs("--config")[1], /ai-shim[\\/]wrangler\.jsonc$/);
  assert.deepEqual(pairs("--env"), ["rig"]);
  assert.deepEqual(pairs("--ip"), ["127.0.0.1"]);
  assert.ok(args.includes("--test-scheduled"));
});

test("a rig Worker never inherits Cloudflare credentials or a wrangler login", () => {
  const layout = rigLayout({ RIG_HOME: "/var/lib/loonext-rig" });
  const env = workerEnv(layout, "/var/lib/loonext-rig/secrets/rig-ca.crt");
  for (const name of CLOUDFLARE_CREDENTIALS) {
    assert.ok(name in env, `${name} is cleared`);
    assert.equal(env[name], undefined);
  }
  assert.ok(CLOUDFLARE_CREDENTIALS.includes("CLOUDFLARE_API_TOKEN"));
  assert.match(env.XDG_CONFIG_HOME, /state[\\/]wrangler-home$/);
  // wrangler prefers a legacy ~/.wrangler over XDG_CONFIG_HOME, so home moves too.
  assert.equal(env.HOME, env.XDG_CONFIG_HOME);
  assert.equal(env.USERPROFILE, env.XDG_CONFIG_HOME);
  assert.equal(env.NODE_EXTRA_CA_CERTS, "/var/lib/loonext-rig/secrets/rig-ca.crt");
  assert.equal(workerEnv(layout, null).NODE_EXTRA_CA_CERTS, undefined);
});

test("arguments parse into flags and positionals", () => {
  assert.deepEqual(parseArgs(["cron", "*/5 * * * *", "--time", "60000"]), {
    positional: ["cron", "*/5 * * * *"],
    flags: { time: "60000" },
  });
  assert.deepEqual(parseArgs(["deploy", "--ref=v1.2.3", "--skip-web"]).flags, { ref: "v1.2.3", "skip-web": true });
  assert.throws(() => parseArgs(["deploy", "--ref"]), /needs a value/);
});

test("Node's offsets match a known rule", () => {
  assert.equal(nodeOffsetMinutes("America/Toronto", new Date("2026-01-15T12:00:00Z")), -300);
  assert.equal(nodeOffsetMinutes("America/Toronto", new Date("2026-07-15T12:00:00Z")), -240);
  assert.equal(nodeOffsetMinutes("America/St_Johns", new Date("2026-01-15T12:00:00Z")), -210);
});

test("a disagreement between Node and Postgres is reported per zone and instant", () => {
  assert.deepEqual(tzMismatches(["America/Toronto|2026-01-15T12:00:00Z|-300"]), []);
  assert.deepEqual(tzMismatches(["America/Toronto|2026-01-15T12:00:00Z|-240"]), [
    { zone: "America/Toronto", at: "2026-01-15T12:00:00Z", node: -300, postgres: -240 },
  ]);
  assert.match(tzProbeSql(["America/Toronto"], [new Date("2026-01-15T12:00:00Z")]), /'America\/Toronto', '2026-01-15T12:00:00\.000Z'::timestamptz/);
});

const STATUS = {
  API_URL: "http://127.0.0.1:54321",
  DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  SECRET_KEY: "sb_secret_local",
  PUBLISHABLE_KEY: "sb_publishable_local",
};

test("supabase status is read only when it describes this machine", () => {
  const banner = `Stopped services: [imgproxy]\n${JSON.stringify(STATUS)}`;
  assert.deepEqual(parseLocalStatus(banner), {
    apiUrl: STATUS.API_URL,
    secretKey: STATUS.SECRET_KEY,
    publishableKey: STATUS.PUBLISHABLE_KEY,
    dbUrl: STATUS.DB_URL,
  });
  assert.equal(parseLocalStatus("not json"), null);
  assert.equal(parseLocalStatus(JSON.stringify({ API_URL: STATUS.API_URL })), null, "no key means no stack");
});

test("a status naming a hosted project is refused, so seed and bootstrap never write there", () => {
  for (const remote of [
    { ...STATUS, API_URL: "https://project.supabase.co" },
    { ...STATUS, DB_URL: "postgresql://postgres:pw@db.project.supabase.co:5432/postgres" },
    { ...STATUS, DB_URL: "postgres://postgres:pw@aws-0-region.pooler.supabase.com:6543/postgres" },
  ]) {
    assert.throws(() => parseLocalStatus(JSON.stringify(remote)), /describes a remote host/);
  }
});
