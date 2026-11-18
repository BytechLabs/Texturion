import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { chromium } from "playwright";

import { startFakeResend } from "../apps/api/e2e/fake-resend.ts";
import { startFakeStripe } from "../apps/api/e2e/fake-stripe.ts";
import { startFakeTelnyx } from "../apps/api/e2e/fake-telnyx.ts";

const API_ROOT = fileURLToPath(new URL("../apps/api/", import.meta.url));
const WEB_ROOT = fileURLToPath(new URL("../apps/web/", import.meta.url));
const INBOX_LINE = "+14155560100";
const CUSTOMER = "+14155560199";
const EMAIL = "dev@loonext.local";
const PASSWORD = "loonext-dev-1234";

function loopback(value) {
  const url = new URL(value);
  assert.ok(
    url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname),
    "The browser journey requires local HTTP origins",
  );
  return url;
}

async function waitForHttp(url, child) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    assert.equal(child.exitCode, null, `Process exited while waiting for ${url}`);
    try {
      await fetch(url, { signal: AbortSignal.timeout(1_000) });
      return;
    } catch {
      await delay(1_000);
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function injectText(api, telnyx, text) {
  const time = new Date().toISOString();
  const body = JSON.stringify({
    data: {
      id: randomUUID(),
      event_type: "message.received",
      occurred_at: time,
      payload: {
        id: randomUUID(),
        type: "SMS",
        direction: "inbound",
        from: { phone_number: CUSTOMER },
        to: [{ phone_number: INBOX_LINE }],
        text,
        received_at: time,
        parts: 1,
        media: [],
      },
    },
    meta: { attempt: 1 },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await crypto.subtle.sign(
    "Ed25519", telnyx.privateKey, new TextEncoder().encode(`${timestamp}|${body}`),
  );
  const response = await fetch(new URL("/webhooks/telnyx", api), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "telnyx-signature-ed25519": Buffer.from(signature).toString("base64"),
      "telnyx-timestamp": timestamp,
    },
    body,
  });
  assert.equal(response.status, 200, "The local Worker must accept the signed text webhook");
}

function waitForRealtime(page) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Supabase Realtime did not join the line")), 25_000);
    page.on("websocket", (socket) => {
      if (!new URL(socket.url()).pathname.includes("/realtime/")) return;
      socket.on("framereceived", ({ payload }) => {
        if (typeof payload !== "string") return;
        const frame = JSON.parse(payload);
        const { topic, event, payload: reply } = Array.isArray(frame)
          ? { topic: frame[2], event: frame[3], payload: frame[4] }
          : frame;
        if (event === "phx_reply" && topic.includes(":number:") && reply.status === "ok") {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
  });
}

async function checkJourney(page, web, api, telnyx) {
  const marker = randomUUID().slice(0, 8);
  const inbound = `Can you look at the kitchen sink? ${marker}`;
  const reply = `Yes, I can visit tomorrow. ${marker}`;
  const task = `Check the kitchen sink ${marker}`;

  await page.goto(new URL("/login", web).href);
  await page.locator("input[type=email]").fill(EMAIL);
  await page.locator("input[type=password]").fill(PASSWORD);
  await page.locator("button[type=submit]").click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  const inbox = await page.context().newPage();
  try {
    const joined = waitForRealtime(inbox);
    await Promise.all([inbox.goto(new URL("/inbox", web).href), joined]);
    assert.equal(await inbox.getByText(inbound, { exact: true }).count(), 0);
    await injectText(api, telnyx, inbound);

    await inbox.getByRole("link", { name: new RegExp(marker) }).click();
    await inbox.waitForURL((url) => /^\/inbox\/[^/]+$/.test(url.pathname));
    const bubbles = inbox.locator('[class~="group/message"]');
    const incomingMessage = bubbles.getByText(inbound, { exact: true });
    await incomingMessage.waitFor();

    const attempts = [];
    const sends = () => telnyx.callsTo("POST", /^\/v2\/messages$/);
    const baseline = sends().length;
    const sendUrl = new URL("/v1/messages/send", api).href;
    await inbox.route(sendUrl, async (route) => {
      const request = route.request();
      if (request.method() !== "POST") {
        await route.continue();
        return;
      }
      const result = await route.fetch();
      attempts.push({
        key: (await request.allHeaders())["idempotency-key"],
        status: result.status(),
        result: await result.json(),
      });
      if (attempts.length === 1) {
        // The Worker has already sent the text. Lose only the browser response.
        await route.abort("connectionreset");
      } else {
        await route.fulfill({ response: result });
      }
    });

    const composer = inbox.locator("[data-composer]");
    const send = inbox.getByRole("button", { name: "Send message" });
    await composer.fill(reply);
    await Promise.all([
      inbox.waitForEvent("requestfailed", {
        predicate: (request) => request.method() === "POST" && request.url() === sendUrl,
      }),
      send.click(),
    ]);
    await inbox.waitForFunction((text) => document.querySelector("[data-composer]")?.value === text, reply);
    await Promise.all([
      inbox.waitForResponse((response) => response.request().method() === "POST" && response.url() === sendUrl),
      send.click(),
    ]);
    await bubbles.getByText(reply, { exact: true }).waitFor();
    assert.equal(attempts.length, 2, "The browser sent exactly one retry");
    assert.ok(attempts[0].key, "The original reply carries an idempotency key");
    assert.equal(attempts[1].key, attempts[0].key, "Retry uses the original idempotency key");
    assert.deepEqual(attempts.map(({ status }) => Math.floor(status / 100)), [2, 2]);
    assert.deepEqual(attempts[1].result, attempts[0].result, "The Worker replays the original result");
    assert.equal(sends().length, baseline + 1, "Only one reply reaches Telnyx");

    await inbox.setViewportSize({ width: 390, height: 640 });
    await incomingMessage.click({ button: "right" });
    await inbox.getByRole("menuitem", { name: "Make a task" }).click();
    const taskForm = inbox.getByRole("dialog", { name: "Make a task" });
    await taskForm.getByLabel("Task", { exact: true }).fill(task);
    const taskUrl = new URL("/v1/tasks", api).href;
    const [created] = await Promise.all([
      inbox.waitForResponse((response) => response.request().method() === "POST" && response.url() === taskUrl),
      taskForm.getByRole("button", { name: "Create", exact: true }).click(),
    ]);
    assert.equal(created.status(), 201);
    assert.equal((await created.json()).title, task);
    await inbox.getByText("Made a task from this message.", { exact: true }).waitFor();
    await taskForm.waitFor({ state: "hidden" });

    await composer.waitFor();
    await injectText(api, telnyx, "STOP");
    await inbox.getByText(/This customer texted STOP, so their carrier/).waitFor();
    await send.waitFor({ state: "hidden" });
    assert.equal(sends().length, baseline + 1, "STOP did not trigger a crew reply");
    await injectText(api, telnyx, "START");
    await send.waitFor();
  } finally {
    await inbox.unrouteAll({ behavior: "wait" });
    await inbox.close();
  }
}

const varsFile = resolve(process.env.LOONEXT_JOURNEY_VARS ?? join(API_ROOT, ".dev.vars"));
const vars = parseEnv(await readFile(varsFile, "utf8"));
assert.equal(vars.DEPLOY_ENV, "local");
loopback(vars.SUPABASE_URL);
const web = loopback(vars.APP_ORIGIN);
const api = loopback(vars.API_ORIGIN);
const bindWeb = new URL(web);
bindWeb.hostname = "127.0.0.1";

const apiRequire = createRequire(join(API_ROOT, "package.json"));
const webRequire = createRequire(join(WEB_ROOT, "package.json"));
const wranglerPath = join(dirname(apiRequire.resolve("wrangler/package.json")), "bin", "wrangler.js");
const env = { ...process.env, WRANGLER_SEND_METRICS: "false" };
const stateDir = await mkdtemp(join(tmpdir(), "loonext-web-journey-"));
const children = [];
const vendors = [];
try {
  const telnyx = await startFakeTelnyx();
  vendors.push(telnyx);
  const stripe = await startFakeStripe();
  vendors.push(stripe);
  const resend = await startFakeResend();
  vendors.push(resend);

  const worker = spawn("node", [
    wranglerPath, "dev", "--local", "--ip", "127.0.0.1", "--port", api.port,
    "--config", process.env.LOONEXT_JOURNEY_WRANGLER ?? "wrangler.ci.jsonc",
    "--env-file", varsFile, "--persist-to", stateDir,
    "--var", `TELNYX_API_BASE:${telnyx.origin}`,
    "--var", `TELNYX_PUBLIC_KEY:${telnyx.publicKeyB64}`,
    "--var", `STRIPE_API_BASE:${stripe.origin}`,
    "--var", `RESEND_API_BASE:${resend.origin}`,
  ], { cwd: API_ROOT, env, stdio: "inherit" });
  children.push(worker);
  const next = spawn("node", [
    webRequire.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "-p", web.port,
  ], { cwd: WEB_ROOT, stdio: "inherit" });
  children.push(next);
  await Promise.all([waitForHttp(api, worker), waitForHttp(bindWeb, next)]);

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    context.setDefaultTimeout(15_000);
    await checkJourney(await context.newPage(), web, api, telnyx);
  } finally {
    await browser.close();
  }
  console.log("web-journey: live text, idempotent reply, job creation and STOP passed");
} catch (error) {
  console.error("web-journey failed", error);
  process.exitCode = 1;
} finally {
  await Promise.all(children.map((child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
    } else {
      child.once("exit", resolve);
      if (process.platform === "win32") {
        spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        child.kill();
      }
    }
  })));
  await Promise.all(vendors.map((vendor) => vendor.close()));
  await rm(stateDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
}
