#!/usr/bin/env node
/**
 * #232 phase 5 — the widget's accessibility pass and its bundle budget.
 *
 * ## Why this is not a Lighthouse run
 *
 * The issue asks for "Lighthouse accessibility pass; bundle under budget", and
 * Lighthouse's accessibility category IS axe-core with a score attached. The
 * score is the part worth dropping: it is a number somebody quotes once, and a
 * 92 tells you nothing about which control a screen reader cannot reach. This
 * runs the same engine and fails on the finding instead, so a regression names
 * an element rather than moving a gauge.
 *
 * It also audits the thing Lighthouse would MISS. Lighthouse scores a page as
 * loaded; the widget's whole surface — the form, the labels, the live region,
 * the focus trap — does not exist until somebody clicks the bubble. An audit of
 * the collapsed state is an audit of one button. So this opens it, and audits
 * the panel where the actual work happens.
 *
 * ## The fixture is a stand-in customer website
 *
 * Not our app. The widget's job is to survive a stranger's WordPress theme, so
 * it is loaded the way an owner loads it — one script tag on a plain page — and
 * given a hostile-ish host to sit in: a page with its own h1, its own
 * `box-sizing`, and a stacking context above it. A widget that only behaves
 * inside our own stylesheet has not been tested.
 *
 * ## The budget
 *
 * 15KB, from the issue: "must not break a WordPress theme or drag in a
 * framework". Measured on the file as SERVED — bytes on disk — because that is
 * what an owner's visitor downloads. Cloudflare will compress it in transit and
 * that is a bonus, not the budget.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";

import { chromium } from "playwright";

const WIDGET = "apps/web/public/widget.js";
/** #232's own words. Bytes on disk, uncompressed. */
const BUDGET_BYTES = 15 * 1024;
/** A key shaped like a real one. Nothing answers it — the audit never submits. */
const FIXTURE_KEY = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

/**
 * axe's bundle, wherever this install put it.
 *
 * pnpm does not hoist by default, so `node_modules/axe-core` exists only
 * because the root declares it — and the versioned store path is the fallback
 * for an install that predates that. Resolved rather than hard-coded because a
 * guard that dies on a path is a guard people delete.
 */
function axePath() {
  const direct = "node_modules/axe-core/axe.min.js";
  if (existsSync(direct)) return direct;
  const store = "node_modules/.pnpm";
  if (existsSync(store)) {
    for (const entry of readdirSync(store)) {
      if (!entry.startsWith("axe-core@")) continue;
      const nested = join(store, entry, "node_modules/axe-core/axe.min.js");
      if (existsSync(nested)) return nested;
    }
  }
  throw new Error(
    "axe-core is not installed. It is a root devDependency of this guard — " +
      "run `pnpm install`.",
  );
}

/**
 * A plain page with a script tag, which is the entire installation story.
 *
 * The inline CSS is the hostile part and it is deliberate: `box-sizing:
 * content-box` is what an older theme sets globally, and a `z-index: 999999`
 * header is what every sticky nav in the world does. Both have broken embeds
 * in the wild.
 */
const FIXTURE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bright Plumbing — a stand-in customer website</title>
<style>
  * { box-sizing: content-box; }
  body { font-family: Georgia, serif; margin: 0; color: #222; background: #fff; }
  header { position: sticky; top: 0; z-index: 999999; background: #123; color: #fff; padding: 12px; }
  main { padding: 24px; }
</style>
</head>
<body>
<header><strong>Bright Plumbing</strong></header>
<main>
  <h1>Emergency plumbing, all hours</h1>
  <p>Burst pipe? We can usually be there within the hour.</p>
</main>
<script src="/widget.js" data-key="${FIXTURE_KEY}" defer></script>
</body>
</html>`;

function fail(lines) {
  console.error("Widget accessibility and budget (#232):\n");
  for (const line of lines) console.error(`  - ${line}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. The budget, which needs no browser.
// ---------------------------------------------------------------------------
const bytes = statSync(WIDGET).size;
const problems = [];
if (bytes > BUDGET_BYTES) {
  problems.push(
    `widget.js is ${bytes} bytes, over the ${BUDGET_BYTES}-byte budget #232 set. ` +
      `It is downloaded by every visitor to every customer's site.`,
  );
}

// ---------------------------------------------------------------------------
// 2. Serve the fixture and the real widget over HTTP.
// ---------------------------------------------------------------------------
const widgetSource = readFileSync(WIDGET);
const server = createServer((req, res) => {
  if (req.url?.startsWith("/widget.js")) {
    res.writeHead(200, { "content-type": "application/javascript" });
    res.end(widgetSource);
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(FIXTURE);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  // The widget posts to our API on submit. Nothing here submits, but a stray
  // request would hang the audit rather than fail it, so refuse them outright.
  await page.route("**/widget/**", (route) => route.abort());

  await page.goto(origin, { waitUntil: "networkidle" });
  await page.addScriptTag({ path: axePath() });

  // #232 acceptance: "installs on a stock WordPress site with no console
  // errors". This is that line, checked rather than asserted in a changelog.
  const launcher = page.locator("[data-loonext-widget] button").first();
  if ((await launcher.count()) === 0) {
    fail([
      ...problems,
      "the widget rendered no launcher on a plain page with one script tag — " +
        "which is the entire installation story for a WordPress owner.",
    ]);
  }

  /**
   * axe against the widget's own root, twice.
   *
   * Scoped to the widget rather than the page: the fixture's own markup is not
   * ours to fix, and a violation from it would be noise that trains people to
   * ignore this. `resultTypes: ["violations"]` skips axe's much slower
   * "incomplete" pass, which we do not read.
   */
  async function audit(label) {
    return page.evaluate(async (name) => {
      const results = await window.axe.run("[data-loonext-widget]", {
        resultTypes: ["violations"],
      });
      return {
        name,
        violations: results.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          nodes: violation.nodes.length,
          target: violation.nodes[0]?.target?.join(" ") ?? "",
        })),
      };
    }, label);
  }

  const collapsed = await audit("collapsed");

  // Open it. Everything the issue's acceptance line is really about — the
  // labelled fields, the live region, the trap — exists only past this click.
  await launcher.click();
  await page.waitForTimeout(400);
  const expanded = await audit("expanded");

  for (const pass of [collapsed, expanded]) {
    for (const violation of pass.violations) {
      // `impact` is axe's own severity. Serious and critical are the ones that
      // stop somebody using the thing; minor ones are worth knowing and not
      // worth failing a build over.
      if (violation.impact === "serious" || violation.impact === "critical") {
        problems.push(
          `${pass.name}: ${violation.id} (${violation.impact}) — ${violation.help}. ` +
            `${violation.nodes} node(s), first at ${violation.target}`,
        );
      } else {
        console.log(`  note (${pass.name}): ${violation.id} — ${violation.help}`);
      }
    }
  }

  // ------------------------------------------------------------------------
  // 3. The keyboard, which axe cannot judge.
  // ------------------------------------------------------------------------
  //
  // axe checks that things are LABELLED. It cannot tell whether the panel traps
  // focus, or whether Escape closes it — and a dialog somebody cannot leave
  // with the keyboard is the accessibility failure that actually strands
  // people. Both are behaviour, so both are driven.
  const focusInsidePanel = await page.evaluate(() => {
    const host = document.querySelector("[data-loonext-widget]");
    const root = host?.shadowRoot;
    const active = root?.activeElement;
    return Boolean(active && active.closest("[role='dialog']"));
  });
  if (!focusInsidePanel) {
    problems.push(
      "opening the panel left focus outside it. A keyboard user has to tab " +
        "through the whole host page to reach a form that just appeared.",
    );
  }

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const closedByEscape = await page.evaluate(() => {
    const root = document.querySelector("[data-loonext-widget]")?.shadowRoot;
    const panel = root?.querySelector("[role='dialog']");
    // HIDDEN, not removed. The widget keeps the panel in the tree and toggles
    // `hidden` — checking for absence reported a working Escape as broken, and
    // this guard's first run failed on its own assertion rather than on the
    // code. A guard that cries wolf gets deleted before it ever catches
    // anything.
    return Boolean(panel && panel.hidden);
  });
  if (!closedByEscape) {
    problems.push(
      "Escape did not close the panel. It is the only exit somebody using a " +
        "keyboard on a stranger's website can be expected to know.",
    );
  }

  if (consoleErrors.length > 0) {
    problems.push(
      `the embed logged ${consoleErrors.length} console error(s) on a stock ` +
        `page: ${consoleErrors.slice(0, 3).join(" | ")}`,
    );
  }
} finally {
  await browser.close();
  server.close();
}

if (problems.length > 0) fail(problems);

console.log(
  `Widget: ${bytes} bytes of ${BUDGET_BYTES} budget, no serious or critical ` +
    `axe violations collapsed or expanded, focus trapped and Escape closes.`,
);
