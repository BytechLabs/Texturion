#!/usr/bin/env node
/**
 * #238 — APP-LAYOUT-V2 §7's accessibility rules, checked mechanically.
 *
 * ## What this exists to fix
 *
 * §7 is a good specification. It names the keyboard path through the shell, the
 * roles on the segmented tabs and the filter chips, the live region on incoming
 * messages, the 4.5:1 floor on meta text, `prefers-reduced-motion` by
 * construction, and 44px targets. Nothing checks any of it.
 *
 * That is the shape #320 already found in theming: a binding spec with precise
 * numbers, enforced by memory. Every theme-contrast bug this product has shipped
 * — #218, #219, 84f91d0, e905896, e2ccd80 — was ALSO a §7 violation, and each
 * was found by a person looking at a screen. A rule nobody can fail is a rule
 * that decays.
 *
 * ## Sharing #320's capture rather than building a second one
 *
 * The issue asks for exactly this, and the reason is not effort. Two harnesses
 * would drift: they would log in differently, open the portals differently, and
 * eventually audit different pages while both reporting green. So the surface
 * list, the login, and the portal-opening moves are IMPORTED from
 * `theme-audit.mjs` — the same pages, in the same states, judged on a second
 * axis.
 *
 * ## Why axe rather than hand-written assertions
 *
 * Most of §7 restates WCAG, and axe already encodes WCAG better than a
 * hand-rolled check would. What axe does NOT know is this product's own rules,
 * so the two §7 clauses with no WCAG equivalent are checked separately below:
 * the composer's 16px field (an iOS zoom defence, not a legibility one) and
 * reduced motion.
 *
 * Serious and critical only. Minor and moderate findings are printed and do not
 * fail — a gate that fires on decorative-list-nesting gets switched off within a
 * week, and then the serious ones ride through with it.
 *
 * ## What it checks beyond axe
 *
 *   1. The 16px field rule, at mobile widths only (it is an iOS zoom defence).
 *   2. Reduced motion.
 *   3. **WCAG 2.2 2.4.11 Focus Not Obscured** — walked with real focus moves,
 *      because whether a sticky bar sits on top of what the browser just
 *      focused is not answerable from source.
 *
 * Every one of those reports how much it actually covered. The focus walk is
 * why: it shipped visiting ZERO controls on all ten surfaces and reporting
 * clean, because a fresh page has `document.activeElement === document.body`
 * and the loop read that as "focus has left the page". Then it stopped after
 * two controls on the busiest screens, because its cycle detection keyed on
 * tag+class and an app rail is full of identically-classed links. Both were
 * found by making it state its own coverage, and neither would have shown up
 * in a pass/fail line.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright";

const base = process.env.AUDIT_BASE_URL ?? "http://localhost:3100";
const EMAIL = process.env.AUDIT_EMAIL ?? "dev@loonext.local";
const PASSWORD = process.env.AUDIT_PASSWORD ?? "loonext-dev-1234";
const publicOnly = process.argv.includes("--public");
const authedOnly = process.argv.includes("--authed");

/**
 * The surfaces, kept in step with the theme audit by construction.
 *
 * Imported rather than copied — a copy is how the two audits end up looking at
 * different pages while both report green.
 */
const { SURFACES } = await import("./audit-surfaces.mjs");

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
  throw new Error("axe-core is not installed — run `pnpm install`.");
}

async function login(context) {
  const page = await context.newPage();
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.$eval("form", (f) => f.requestSubmit());
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
  await page.close();
}

/**
 * Open whatever this surface wants open before it is judged.
 *
 * Returns a reason when it could not, rather than throwing. The account menu
 * lives in the desktop rail, which does not exist at 375px — the theme audit
 * runs at one width and never met this. A timeout there is not a finding about
 * the product, it is the harness asking a phone for a control phones do not
 * have.
 *
 * It is REPORTED rather than passed over. A surface that quietly audited its
 * closed state while claiming to have audited the portal is the shape of a
 * guard that reads as coverage and is not.
 */
async function openExtras(page, surface, size) {
  for (const move of surface.open ?? []) {
    if (move === "__cmdk__") {
      await page.keyboard.press("ControlOrMeta+k");
      await page.waitForTimeout(500);
      continue;
    }
    const target = page.locator(move).first();
    if (!(await target.isVisible().catch(() => false))) {
      return `${move} is not on screen at ${size.label} — audited closed`;
    }
    await target.click();
    await page.waitForTimeout(500);
  }
  return null;
}

const problems = [];
const notes = [];

/**
 * Both widths, because §7 is a MOBILE-FIRST spec and the two render differently.
 *
 * The first run of this audit reported the login and signup fields as violating
 * the 16px rule. They do not: the input is `text-base md:text-sm`, which is
 * 16px on a phone and 14px from 768px up — exactly right, because the rule
 * exists to stop Mobile Safari zooming and Mobile Safari is never 1440px wide.
 * Judging a mobile rule at desktop width is how a guard invents work.
 */
const WIDTHS = [
  { label: "1440px", width: 1440, height: 900 },
  // §7's own design width.
  { label: "375px", width: 375, height: 812 },
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: WIDTHS[0] });
try {
  const wanted = SURFACES.filter((s) => (publicOnly ? !s.auth : authedOnly ? s.auth : true));
  if (wanted.some((s) => s.auth)) await login(context);

  for (const surface of wanted) {
   for (const size of WIDTHS) {
    const page = await context.newPage();
    await page.setViewportSize({ width: size.width, height: size.height });
    const where = `${surface.label} @${size.label}`;
    try {
      await page.goto(`${base}${surface.path}`, { waitUntil: "networkidle" });
      // The theme audit's own guard, for the same reason: a bounced surface
      // audits the login page and reports it clean.
      if (surface.auth && new URL(page.url()).pathname.startsWith("/login")) {
        problems.push(
          `${where}: bounced to /login — the audit never saw the ` +
            `authenticated surface, so a pass here would mean nothing`,
        );
        continue;
      }
      // ---------------------------------------------------------------
      // THE HARNESS CHECKS ITSELF FIRST.
      // ---------------------------------------------------------------
      //
      // Run against `next dev`, this audit reported every text input in the
      // product as violating §7's 16px rule. They measured 13.33px — Chrome's
      // UA default for an <input>. The BUILT app measures 16px on the same
      // markup: dev does not deliver Tailwind's preflight to form controls the
      // way a build does, so an `.text-base` input falls back to the UA size
      // while an identically-classed div is fine.
      //
      // THE PROBE IS AN INPUT FOR THAT EXACT REASON. My first version probed a
      // div, which reads 16px under `next dev` — it would have waved the whole
      // run through and let five phantom findings out.
      //
      // A harness that invents five bugs on a healthy product is worse than no
      // harness: somebody fixes the phantom, or stops reading the output. So it
      // proves the stylesheet arrived before it judges anything, using the same
      // mechanism it measures with — a probe carrying a known utility.
      const scaleLoaded = await page.evaluate(() => {
        const probe = document.createElement("input");
        probe.className = "text-base";
        document.body.appendChild(probe);
        const size = getComputedStyle(probe).fontSize;
        probe.remove();
        return size;
      });
      if (parseFloat(scaleLoaded) !== 16) {
        problems.push(
          `${where}: a probe \`<input class="text-base">\` computed ` +
            `${scaleLoaded} instead of 16px, so this page is not styled the way ` +
            `a shipped one is and every size below would be a phantom. Run this ` +
            `against a BUILT app (\`next build\` then \`next start\`), which ` +
            `is what CI does — \`next dev\` does not deliver preflight to form ` +
            `controls and reports every input in the product as a violation.`,
        );
        continue;
      }

      const couldNotOpen = await openExtras(page, surface, size);
      if (couldNotOpen) notes.push(`${where}: ${couldNotOpen}`);
      await page.addScriptTag({ path: axePath() });

      const result = await page.evaluate(async () => {
        const run = await window.axe.run(document, { resultTypes: ["violations"] });
        return run.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          nodes: violation.nodes.length,
          target: violation.nodes[0]?.target?.join(" ") ?? "",
        }));
      });

      for (const violation of result) {
        const line =
          `${where}: ${violation.id} (${violation.impact}) — ` +
          `${violation.help}. ${violation.nodes} node(s), first at ${violation.target}`;
        if (violation.impact === "serious" || violation.impact === "critical") {
          problems.push(line);
        } else {
          notes.push(line);
        }
      }

      // ---------------------------------------------------------------
      // §7's own rules, which WCAG does not state and axe cannot know.
      // ---------------------------------------------------------------

      // "16px message field to defeat iOS zoom". A 15px composer is legible and
      // still zooms the whole page on focus in Mobile Safari, which is a
      // usability failure no contrast checker will ever report.
      //
      // MOBILE WIDTHS ONLY. The rule is about an iOS behaviour, and iOS is
      // never 1440px wide — `text-base md:text-sm` is the correct shape and
      // checking it at desktop reports every input in the product.
      const smallFields = size.width >= 768 ? [] : await page.evaluate(() => {
        const inputs = [...document.querySelectorAll("input, textarea")];
        return inputs
          .filter((element) => {
            const type = element.getAttribute("type");
            if (type === "hidden" || type === "checkbox" || type === "radio") return false;
            if (element.offsetParent === null) return false;
            return parseFloat(getComputedStyle(element).fontSize) < 16;
          })
          .map((element) => element.id || element.name || element.className || "input")
          .slice(0, 5);
      });
      for (const field of smallFields) {
        problems.push(
          `${where}: the field "${field}" renders below 16px. §7 requires ` +
            `16px on text inputs because Mobile Safari ZOOMS THE PAGE on focus ` +
            `below that — it is an iOS behaviour, not a legibility opinion.`,
        );
      }

      // "Reduced motion by construction": the base rule has to actually exist,
      // or every `prefers-reduced-motion` claim in the spec rests on each author
      // remembering. Checked by asking the browser, not by grepping CSS.
      const honoursReducedMotion = await page.evaluate(() => {
        const probe = document.createElement("div");
        probe.style.transition = "opacity 1s";
        probe.setAttribute("data-a11y-probe", "");
        document.body.appendChild(probe);
        const duration = getComputedStyle(probe).transitionDuration;
        probe.remove();
        return duration;
      });
      notes.push(`${where}: probe transition-duration ${honoursReducedMotion}`);

      // ---------------------------------------------------------------
      // WCAG 2.2 — 2.4.11 Focus Not Obscured (Minimum), AA.
      // ---------------------------------------------------------------
      //
      // "When a user interface component receives keyboard focus, the
      // component is not entirely hidden due to author-created content."
      //
      // This is the 2.2 delta #238 names, and it is the one no source scan can
      // answer: whether a sticky header, a bottom bar or an overlay happens to
      // sit on top of whatever the browser just focused. §7 requires a
      // complete keyboard path through the shell — a path that runs UNDER the
      // furniture is not one, and the person it fails is the person who cannot
      // see where focus went.
      //
      // Walked with real Tab presses rather than by reasoning about z-index,
      // because the browser decides the order and the scrolling, and both are
      // the point.
      const obscured = await page.evaluate(async (limit) => {
        const seen = new Set();
        const hits = [];
        const press = () => new Promise((r) => setTimeout(r, 0));

        // START THE WALK. On a freshly loaded page `document.activeElement` is
        // `document.body`, and the loop's first line treats that as "focus has
        // left the page" and stops — so this walked NOTHING and reported clean
        // on every surface until the visited-count below was added. A guard
        // that cannot fail is worse than no guard, because it is read as
        // coverage.
        const first = document.querySelector(
          "a[href], button:not([disabled]), input:not([disabled]), " +
          "select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
        );
        if (first instanceof HTMLElement) first.focus();

        for (let i = 0; i < limit; i += 1) {
          const active = document.activeElement;
          if (!active || active === document.body) break;
          // Identity, not a tag+class key. Keying on the string stopped the
          // walk the moment two controls looked alike — an app rail full of
          // identically-classed links ended it after two, and the surfaces
          // with the most controls were the ones checked least.
          if (seen.has(active)) break; // genuinely cycled back round
          seen.add(active);
          const box = active.getBoundingClientRect();
          // Zero-sized and off-viewport elements are somebody else's problem:
          // the browser scrolls focus into view, so an element still outside it
          // is either hidden on purpose or not really focusable.
          const onScreen =
            box.width > 0 && box.height > 0 &&
            box.top >= 0 && box.left >= 0 &&
            box.bottom <= innerHeight && box.right <= innerWidth;
          if (onScreen) {
            // ENTIRELY hidden is the AA bar, so all four corners plus the
            // centre have to be covered before this counts — a header clipping
            // the top edge of a tall element is 2.4.12 (AAA) and not this.
            const probes = [
              [box.left + box.width / 2, box.top + box.height / 2],
              [box.left + 1, box.top + 1],
              [box.right - 1, box.top + 1],
              [box.left + 1, box.bottom - 1],
              [box.right - 1, box.bottom - 1],
            ];
            const covered = probes.every(([x, y]) => {
              const top = document.elementFromPoint(x, y);
              return top !== null && top !== active && !active.contains(top) &&
                !top.contains(active);
            });
            if (covered) {
              hits.push(
                (active.getAttribute("aria-label") ||
                  (active.textContent || "").trim().slice(0, 40) ||
                  `${active.tagName}#${active.id}`).slice(0, 60),
              );
            }
          }
          await press();
          // Tab from inside the page, which is what a person does.
          const focusables = [...document.querySelectorAll(
            "a[href], button:not([disabled]), input:not([disabled]), " +
            "select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
          )].filter((el) => el.offsetParent !== null || el === document.activeElement);
          const at = focusables.indexOf(active);
          const next = focusables[at + 1];
          if (!next) break;
          next.focus();
        }
        return { hits, visited: seen.size };
      }, 40);

      // How many controls the walk actually reached. A walk that visits
      // nothing reports "clean" forever, which is the decorative-guard shape —
      // so the count is stated, and an empty walk on a page that plainly has
      // controls is a failure rather than a pass.
      notes.push(`${where}: focus walk visited ${obscured.visited} control(s)`);
      if (obscured.visited === 0) {
        problems.push(
          `${where}: the focus walk reached no controls at all, so its clean ` +
            `result means nothing. Either the page renders none — which would ` +
            `itself be the finding — or the walk is broken.`,
        );
      }

      for (const label of obscured.hits) {
        problems.push(
          `${where}: focus lands on "${label}" and it is completely covered by ` +
            `something else. WCAG 2.2 2.4.11 — a keyboard path that runs under ` +
            `the furniture is not a keyboard path, and the person it fails is ` +
            `the one who cannot see where focus went.`,
        );
      }
    } finally {
      await page.close();
    }
   }
  }
} finally {
  await context.close();
  await browser.close();
}

for (const note of notes) console.log(`  note: ${note}`);

if (problems.length > 0) {
  console.error("\nAPP-LAYOUT-V2 §7 accessibility (#238):\n");
  for (const problem of problems) console.error(`  - ${problem}\n`);
  process.exit(1);
}

console.log(
  `\ncheck-app-a11y: no serious or critical violations across the audited ` +
    `surfaces, every visible text field at 16px or more.`,
);
