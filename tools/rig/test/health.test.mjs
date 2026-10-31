import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { main } from "../src/cli.mjs";
import { healthChecks, runHealth } from "../src/health.mjs";
import { DEFAULT_SETTINGS, rigLayout } from "../src/layout.mjs";
import { secretStore } from "../src/secrets.mjs";
import { startStubGuard, STUB_TOKEN } from "./support/stub-guard.mjs";

const SHA = "a".repeat(40);
const OWNED = ["+14165550100", "+14165550101", "+14165550103"];

/** A RIG_HOME with a deployed worktree, and the context `rig health` builds from it. */
async function withRig(body) {
  const home = mkdtempSync(join(tmpdir(), "rig-health-"));
  try {
    const layout = rigLayout({ RIG_HOME: home });
    const worktree = join(home, "worktrees", SHA);
    mkdirSync(join(worktree, "apps", "api"), { recursive: true });
    writeFileSync(join(worktree, "apps", "api", ".dev.vars.rig"), `RIG_OWNED_E164=${OWNED.join(",")}\nSTRIPE_WEBHOOK_SECRET=whsec_rig\n`);
    writeFileSync(join(worktree, "apps", "api", "wrangler.jsonc"), JSON.stringify({ triggers: { crons: ["* * * * *", "0 13 * * *"] } }));
    const store = secretStore(layout.secrets);
    store.write("guard-token-rig-api", STUB_TOKEN);
    store.write("tenants.json", { "qa-w": { members: { owner: { email: "owner@rig.invalid", password: "pw" } } } });
    const context = {
      layout,
      settings: { ...DEFAULT_SETTINGS, systemd: false },
      store,
      status: { apiUrl: "http://127.0.0.1:54321", secretKey: "sb_secret_local", publishableKey: "sb_publishable_local" },
      projectId: "rig",
      deployed: { sha: SHA, worktree, timers: [] },
      published: { serving: {} },
    };
    return await body(context, home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function token(alg) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg, typ: "JWT" })}.${part({ sub: "u" })}.sig`;
}

test("the database check compares the posture's endpoints with the API's list", async () => {
  await withRig(async (context) => {
    let posture;
    context.fetch = async () => json(posture);
    const { database } = healthChecks(context);
    posture = { deploy_env: "rig", endpoints: OWNED.length };
    assert.equal(await database(), null);
    posture = { deploy_env: "rig", endpoints: OWNED.length - 1 };
    assert.equal(await database(), `the database lists ${OWNED.length - 1} endpoint(s), the API ${OWNED.length}`);
    posture = { deploy_env: "", endpoints: 0 };
    assert.equal(await database(), "the database does not say rig");
  });
});

test("sign-in must be ES256 and reach /v1/me", async () => {
  await withRig(async (context) => {
    let alg;
    let me = 200;
    context.fetch = async (url) => {
      if (url.includes("/auth/v1/token")) return json({ access_token: token(alg) });
      if (url.endsWith("/v1/me")) return json({}, me);
      throw new Error(`unexpected ${url}`);
    };
    const { signIn } = healthChecks(context);
    alg = "HS256";
    assert.equal(await signIn(), "local auth signs HS256, and the API accepts ES256 only");
    alg = "ES256";
    assert.equal(await signIn(), null);
    me = 401;
    assert.equal(await signIn(), "GET /v1/me answered 401");
  });
});

test("the API check reports the posture refusal and a SHA other than the deployed one", async () => {
  await withRig(async (context) => {
    let health;
    context.fetch = async () => health();
    const { api } = healthChecks(context);
    health = () => json({ error: { code: "service_unavailable", message: "rig mode: the database is not in rig posture" } }, 503);
    assert.equal(await api(), "the API is not serving: rig mode: the database is not in rig posture");

    health = () => json({ ok: true });
    assert.equal(await api(), "rig serve api has not recorded what it serves");
    mkdirSync(context.layout.state, { recursive: true });
    const serving = join(context.layout.state, "serving-api.json");
    writeFileSync(serving, JSON.stringify({ sha: "b".repeat(40) }));
    assert.equal(await api(), `the api serves ${"b".repeat(12)}, but deployed.json names ${"a".repeat(12)}`);
    writeFileSync(serving, JSON.stringify({ sha: SHA }));
    assert.equal(await api(), null);
    assert.equal(context.published.serving.api, SHA);
  });
});

test("the nonprod apps check is the guard's own start-up check", async () => {
  const guard = await startStubGuard();
  try {
    await withRig(async (context) => {
      context.store.write("edge-origin", guard.origin);
      assert.equal(await healthChecks(context).nonprodApps(), null);
      assert.ok(guard.requests.every((request) => request.path === "/g/health"), "it reads nothing but the guard's /health");

      const answer = (safety) => {
        context.fetch = async () => json({ ok: false, telnyx: safety === undefined ? {} : { safety } });
        return healthChecks(context).nonprodApps();
      };
      assert.equal(
        await answer({ state: "unsafe", reasons: ["webhook_not_edge:app:nonprod-robot"], checked_at: Date.now() }),
        "the guard's start-up checks say unsafe: webhook_not_edge:app:nonprod-robot",
      );
      assert.equal(
        await answer({ state: "ok", reasons: [], checked_at: Date.now() - 7 * 3_600_000 }),
        "the guard's start-up checks have not run for over six hours",
      );
      assert.equal(await answer(undefined), "the guard's /health does not report its start-up checks");
    });
  } finally {
    await guard.close();
  }
});

test("an unclassified cron or an idle timer fails the crons check", async () => {
  await withRig(async (context) => {
    context.cronRegistry = { crons: [{ config: "apps/api/wrangler.jsonc", cron: "* * * * *", class: "run" }] };
    assert.match(await healthChecks(context).crons(), /1 cron\(s\) tools\/rig\/crons\.json does not classify have no timer: 0 13 \* \* \*/);

    context.cronRegistry.crons.push({ config: "apps/api/wrangler.jsonc", cron: "0 13 * * *", class: "skip" });
    assert.equal(await healthChecks(context).crons(), null);

    context.settings = { ...context.settings, systemd: true };
    let active = "inactive";
    context.systemctl = () => ({ stdout: `${active}\n` });
    assert.equal(await healthChecks(context).crons(), "no active timer for 1 cron(s): * * * * *");
    context.deployed.timers = [{ cron: "* * * * *", timer: "loonext-rig-cron-c00.timer" }];
    assert.equal(await healthChecks(context).crons(), "no active timer for 1 cron(s): * * * * *");
    active = "active";
    assert.equal(await healthChecks(context).crons(), null);
  });
});

test("a rig that cannot be measured writes a failing report over the last green one", async () => {
  await withRig(async (context) => {
    mkdirSync(context.layout.state, { recursive: true });
    const path = join(context.layout.state, "health.json");
    writeFileSync(path, JSON.stringify({ at: "2026-01-01T00:00:00.000Z", results: [{ name: "api", pass: true }] }));
    const report = await runHealth({ layout: context.layout, deployed: context.deployed, unavailable: "rig: the local stack is not running; run rig stack up" });
    const written = JSON.parse(readFileSync(path, "utf8"));
    assert.deepEqual(written, report);
    assert.ok(written.results.length >= 10);
    assert.ok(written.results.every((result) => !result.pass && result.reason === "rig: the local stack is not running; run rig stack up"));
    assert.equal(written.sha, SHA);
    assert.ok(Date.now() - Date.parse(written.at) < 60_000);
  });
});

test("rig health with nothing deployed still writes its report and exits 1", async () => {
  await withRig(async (context, home) => {
    const lines = [];
    const code = await main(["health"], { env: { RIG_HOME: home }, log: (line) => lines.push(line) });
    assert.equal(code, 1);
    const written = JSON.parse(readFileSync(join(context.layout.state, "health.json"), "utf8"));
    assert.equal(written.sha, null);
    assert.ok(written.results.every((result) => !result.pass && /nothing is deployed yet/.test(result.reason)));
    assert.ok(lines.some((line) => line.startsWith("FAIL  api  rig: nothing is deployed yet")));
  });
});
