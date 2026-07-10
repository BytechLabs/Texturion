/**
 * Authenticated screenshot harness for the local dev app (#114/#101 unblock).
 *
 * Logs into the web app as the dev-seed user (scripts/dev-seed.mjs) with a
 * cached storage state, then captures one or more app routes headlessly so
 * visual work on authenticated screens can be judged from real pixels.
 *
 * Usage:
 *   node scripts/dev-shot.mjs [options] <path> [<path>...]
 *
 * Options:
 *   --mobile              390x844 viewport (default 1440x900)
 *   --full                full-page screenshot instead of the viewport
 *   --click <selector>    after load, click this (repeatable; e.g. to open
 *                         the conversation info panel)
 *   --wait <ms>           settle delay after load/clicks (default 600)
 *   --out <dir>           output directory (default .dev-shots)
 *   --base <url>          app origin (default http://localhost:3100)
 *   --fresh               ignore the cached login state and log in again
 *
 * Example — the conversation info panel on desktop and mobile:
 *   node scripts/dev-shot.mjs --click "[aria-label='Conversation info']" /inbox/<id>
 *   node scripts/dev-shot.mjs --mobile --click "[aria-label='Conversation info']" /inbox/<id>
 */
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const EMAIL = "dev@loonext.local";
const PASSWORD = "loonext-dev-1234";
const STATE_DIR = join("node_modules", ".cache", "dev-shot");
const STATE_FILE = join(STATE_DIR, "state.json");

const args = process.argv.slice(2);
const paths = [];
const clicks = [];
let mobile = false;
let fullPage = false;
let settle = 600;
let outDir = ".dev-shots";
let base = "http://localhost:3100";
let fresh = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--mobile") mobile = true;
  else if (a === "--full") fullPage = true;
  else if (a === "--fresh") fresh = true;
  else if (a === "--click") clicks.push(args[++i]);
  else if (a === "--wait") settle = Number(args[++i]);
  else if (a === "--out") outDir = args[++i];
  else if (a === "--base") base = args[++i];
  else paths.push(a);
}

if (paths.length === 0) {
  console.error("usage: node scripts/dev-shot.mjs [options] <path> [<path>...]");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
mkdirSync(STATE_DIR, { recursive: true });

const viewport = mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 };
const browser = await chromium.launch();

async function login(context) {
  const page = await context.newPage();
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  // requestSubmit drives the react-hook-form handler exactly like a user Enter.
  await page.$eval("form", (f) => f.requestSubmit());
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
  await context.storageState({ path: STATE_FILE });
  await page.close();
}

let context;
if (!fresh && existsSync(STATE_FILE)) {
  context = await browser.newContext({ viewport, storageState: STATE_FILE });
} else {
  context = await browser.newContext({ viewport });
  await login(context);
}

for (const path of paths) {
  const page = await context.newPage();
  await page.goto(`${base}${path}`, { waitUntil: "networkidle" });

  // A cached state whose session expired bounces to /login — re-login once.
  if (new URL(page.url()).pathname.startsWith("/login")) {
    await page.close();
    await context.close();
    context = await browser.newContext({ viewport });
    await login(context);
    const retry = await context.newPage();
    await retry.goto(`${base}${path}`, { waitUntil: "networkidle" });
    await shoot(retry, path);
    await retry.close();
    continue;
  }

  await shoot(page, path);
  await page.close();
}

async function shoot(page, path) {
  for (const selector of clicks) {
    await page.click(selector, { timeout: 10_000 });
  }
  await page.waitForTimeout(settle);
  const slug = path.replaceAll("/", "_").replaceAll(/[^\w-]/g, "") || "root";
  const file = join(outDir, `${slug}${mobile ? ".mobile" : ""}.png`);
  await page.screenshot({ path: file, fullPage });
  console.log(file);
}

await context.close();
await browser.close();
