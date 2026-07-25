/**
 * Authenticated screenshot harness for the local dev app (#114/#101 unblock).
 *
 * Logs into the web app as the dev-seed user (scripts/dev-seed.mjs) with a
 * cached storage state, then captures one or more app routes headlessly so
 * visual work on authenticated screens can be judged from real pixels.
 *
 * Every capture also reports what the page hit at runtime: uncaught errors,
 * console errors, failed requests, and 4xx/5xx responses. A screen can look
 * right in a screenshot while it is throwing, so the pixels alone are not
 * enough to call it working.
 *
 * Usage:
 *   node scripts/dev-shot.mjs [options] <path> [<path>...]
 *
 * Options:
 *   --mobile              390x844 viewport (default 1440x900)
 *   --dark                dark theme (emulates prefers-color-scheme: dark and
 *                         sets the next-themes localStorage key to "dark")
 *   --full                full-page screenshot instead of the viewport
 *   --click <selector>    after load, click this (repeatable; e.g. to open
 *                         the conversation info panel)
 *   --el <selector>       capture just this element instead of the page
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
let dark = false;
let fullPage = false;
let element = null;
let settle = 600;
let outDir = ".dev-shots";
let base = "http://localhost:3100";
let fresh = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--mobile") mobile = true;
  else if (a === "--dark") dark = true;
  else if (a === "--full") fullPage = true;
  else if (a === "--fresh") fresh = true;
  else if (a === "--click") clicks.push(args[++i]);
  else if (a === "--el") element = args[++i];
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
const colorScheme = dark ? "dark" : "light";
const browser = await chromium.launch();

async function applyTheme(context) {
  // Cover both next-themes modes: "system" (matchMedia, via colorScheme
  // emulation on the context) and an explicit stored choice.
  await context.addInitScript((theme) => {
    try {
      window.localStorage.setItem("theme", theme);
    } catch {}
  }, dark ? "dark" : "light");
}

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
  context = await browser.newContext({ viewport, colorScheme, storageState: STATE_FILE });
  await applyTheme(context);
} else {
  context = await browser.newContext({ viewport, colorScheme });
  await applyTheme(context);
  await login(context);
}

/** Runtime complaints seen since the last capture, in the order they happened. */
let problems = [];

/**
 * A dev server serves its own machinery over the same origin. Those requests
 * failing says nothing about the app, and reporting them trains the reader to
 * ignore the list.
 */
const IGNORED_REQUESTS = [/\/__nextjs/, /\/_next\/static\/webpack\//, /hot-update/];

function watch(page) {
  problems = [];
  page.on("pageerror", (error) => problems.push(`uncaught: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    if (IGNORED_REQUESTS.some((p) => p.test(request.url()))) return;
    problems.push(`request failed: ${request.url()} (${request.failure()?.errorText})`);
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    if (IGNORED_REQUESTS.some((p) => p.test(response.url()))) return;
    problems.push(`HTTP ${response.status()}: ${response.url()}`);
  });
}

for (const path of paths) {
  const page = await context.newPage();
  watch(page);
  await page.goto(`${base}${path}`, { waitUntil: "networkidle" });

  // A cached state whose session expired bounces to /login — re-login once.
  if (new URL(page.url()).pathname.startsWith("/login")) {
    await page.close();
    await context.close();
    context = await browser.newContext({ viewport, colorScheme });
    await applyTheme(context);
    await login(context);
    const retry = await context.newPage();
    watch(retry);
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
  const file = join(outDir, `${slug}${mobile ? ".mobile" : ""}${dark ? ".dark" : ""}.png`);
  if (element) {
    await page.locator(element).first().screenshot({ path: file });
  } else {
    await page.screenshot({ path: file, fullPage });
  }
  console.log(file);

  // One line per distinct complaint: a single fault that fires on every render
  // would otherwise bury the rest.
  for (const problem of [...new Set(problems)]) {
    console.log(`  ! ${problem}`);
  }
}

await context.close();
await browser.close();
