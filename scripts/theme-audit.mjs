/**
 * #320 — contrast measured on RENDERED OUTPUT, in both themes, in CI.
 *
 * The token tests (`globals.contrast.test.ts`, `marketing-dark.test.ts`,
 * `ThemeContrastTest.kt`, `BrandColorContrastTests.swift`) prove the palette is
 * legal. They cannot prove the palette REACHED the screen, and that gap is not
 * hypothetical — it is #116, the bug that made this issue structural rather
 * than cosmetic:
 *
 *   Radix overlays portal into `document.body`, OUTSIDE the `.app-scope` div.
 *   Out there every `var(--app-*)` is invalid at computed-value time, so
 *   portaled surfaces painted TRANSPARENT backgrounds, currentColor borders,
 *   and fell back to Inter. Every token involved was correct. The cascade was
 *   the fault.
 *
 * No amount of reading source finds that. You have to render it and ask the
 * browser what colour things actually are.
 *
 * WHY NOT SCREENSHOTS. #320's own devil's advocate: pixel diffs produce noisy
 * diffs that get rubber-stamped, which converts a quality gate into a rubber
 * stamp and is worse than nothing. It names the better instrument — assert on
 * ratios, because those fail only when something is genuinely wrong. This reads
 * `getComputedStyle` and does arithmetic. There is no image to diff, nothing to
 * re-baseline, and a failure always names an element and a number.
 *
 * TWO FAULTS ARE REPORTED, and they are different in kind:
 *
 *   UNPAINTED  A surface whose background resolved to nothing. This is the
 *              #116 signature exactly: the declaration was dropped because the
 *              custom property did not exist in that scope.
 *   CONTRAST   Text that resolved below its WCAG threshold, against the
 *              background actually behind it (walked up the ancestor chain,
 *              because the element itself is usually transparent).
 *
 * Usage:
 *   node scripts/theme-audit.mjs                  # every surface
 *   node scripts/theme-audit.mjs --public         # only the ones needing no login
 *   node scripts/theme-audit.mjs --base http://localhost:3100
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const EMAIL = "dev@loonext.local";
const PASSWORD = "loonext-dev-1234";
const STATE_DIR = join("node_modules", ".cache", "theme-audit");
const STATE_FILE = join(STATE_DIR, "state.json");

const args = process.argv.slice(2);
const publicOnly = args.includes("--public");
const baseIndex = args.indexOf("--base");
const base = baseIndex >= 0 ? args[baseIndex + 1] : "http://localhost:3100";

/**
 * The surfaces to audit. Deliberately SMALL — #320's devil's advocate is right
 * that a check covering everything is a check nobody reads. Each entry earns
 * its place by being a surface where a theme bug has actually happened or where
 * the token scope is genuinely at risk.
 */
const SURFACES = [
  // Marketing: its own palette, its own scope, and newly dark (#362 phase 8).
  { path: "/", label: "marketing home", auth: false },
  { path: "/pricing", label: "marketing pricing", auth: false },
  // #218 was literally "auth screens unreadable in light mode".
  { path: "/login", label: "login", auth: false },
  { path: "/signup", label: "signup", auth: false },
  // The authenticated shell, and then the PORTALS — #116's own ground.
  { path: "/for-you", label: "for-you (the post-login landing)", auth: true },
  { path: "/inbox", label: "inbox", auth: true },
  {
    path: "/inbox",
    label: "inbox · account menu (portal)",
    auth: true,
    // The see-through account surface IS the #116 bug. Opening it is the point:
    // this is the one entry here that audits a subtree rendered OUTSIDE
    // `.app-scope`, which is the only place the cascade fault can happen.
    open: ['[aria-label="Account and settings"]'],
  },
  {
    path: "/inbox",
    label: "inbox · command palette (portal)",
    auth: true,
    // A second portal, opened a different way (keyboard), because the account
    // menu and the palette mount through different Radix primitives.
    open: ["__cmdk__"],
  },
  { path: "/settings", label: "settings", auth: true },
  { path: "/tasks", label: "tasks", auth: true },
];

/* ------------------------------------------------------------------------- */

const problems = [];

/** In-page: read every visible text node's effective colours and flag faults. */
const AUDIT = () => {
  const parse = (css) => {
    const m = css.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = "1"] = m[1].split(",").map((s) => parseFloat(s.trim()));
    return { r, g, b, a };
  };
  const lum = ({ r, g, b }) => {
    const ch = (c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  };
  const ratio = (a, b) => {
    const x = lum(a);
    const y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  /** Composite a translucent colour over what is behind it. */
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });

  /** The colour actually behind `el`, walking up until something paints. */
  const backdrop = (el) => {
    let layers = [];
    let node = el;
    while (node && node !== document.documentElement.parentNode) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0) {
        layers.push(bg);
        if (bg.a >= 0.999) break;
      }
      node = node.parentElement;
    }
    if (!layers.length) return null;
    // Bottom-most opaque layer up, compositing each translucent one onto it.
    let result = layers.pop();
    while (layers.length) result = over(layers.pop(), result);
    return result;
  };

  const faults = [];
  const seen = new Set();

  // 0) IS THERE ANYTHING HERE AT ALL?
  //
  // This check exists because the audit shipped without it and immediately lied.
  // With the API worker down, every authenticated route renders "Loading your
  // workspace…" — one line of text on a bare body, with the app token scope
  // never mounted. The audit found no contrast faults and reported those
  // surfaces GREEN, which is the exact failure mode #320 warns about: a check
  // that silently examines nothing is worse than no check, because it also
  // tells you everything is fine.
  const painted = document.querySelectorAll("body *").length;
  const loading = /loading your workspace|loading…/i.test(document.body.innerText || "");
  if (painted < 40 || loading) {
    faults.push({
      kind: "EMPTY",
      what: `${painted} elements${loading ? ", still on a loading state" : ""}`,
      detail:
        "this surface never rendered, so nothing below was measured. An " +
        "authenticated route needs the API worker up; a marketing route this " +
        "bare is a routing or build failure.",
    });
    return faults;
  }

  // 1) A PORTAL THAT ESCAPED ITS TOKEN SCOPE.
  //
  // #116: Radix overlays portal into `document.body`, outside the `.app-scope`
  // div, where every `var(--app-*)` was invalid at computed-value time — so
  // they painted TRANSPARENT. `PortalScope` fixes it by mounting the scope on
  // <body> for as long as an (app) route is mounted.
  //
  // THE SIGNATURE HAS MOVED, and the first version of this check was written
  // against the old one. Since #116, `:root` carries a full token set, so an
  // overlay that escapes the scope no longer paints nothing — it paints the
  // ROOT palette. Removing PortalScope and re-running proved it: transparency
  // never appeared, and a check looking for transparency reported green over a
  // genuinely broken app.
  //
  // So the test is equality, not emptiness: the ground an overlay actually
  // paints must be the ground the app scope defines. If they differ, the
  // element resolved its tokens somewhere else, which is #116 whatever it
  // happens to look like this year.
  const scope = document.querySelector(".app-scope");
  if (scope) {
    const expected = ["--popover", "--card", "--background"]
      .map((name) => getComputedStyle(scope).getPropertyValue(name).trim().toLowerCase())
      .filter(Boolean);
    const asRgb = (value) => {
      const probe = document.createElement("span");
      probe.style.color = value;
      document.body.appendChild(probe);
      const out = getComputedStyle(probe).color;
      probe.remove();
      return out;
    };
    const allowed = new Set(expected.map(asRgb));
    const overlays = document.querySelectorAll(
      '[role="dialog"],[role="menu"],[data-radix-popper-content-wrapper] > *,[data-sonner-toast]',
    );
    for (const el of overlays) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) continue;
      const own = getComputedStyle(el).backgroundColor;
      const parsed = parse(own);
      // Transparent is fine when it is nested inside a surface that paints —
      // the command palette's listbox is transparent BY DESIGN because the
      // dialog around it carries the ground. Only the element that IS the
      // surface is judged.
      if (!parsed || parsed.a < 0.5) continue;
      if (allowed.has(own)) continue;
      faults.push({
        kind: "ESCAPED-SCOPE",
        what: `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""}`,
        detail:
          `ground is ${own}, but the app scope defines ${[...allowed].join(" / ")}. ` +
          `This element resolved its tokens outside .app-scope — the #116 shape. ` +
          `Check that PortalScope is still mounted by the (app) layout.`,
      });
    }

    // THE HALF OF #116 THAT IS STILL LIVE.
    //
    // Removing PortalScope and re-running this audit changed nothing, which was
    // not the expected result and is worth recording: since #362 converged the
    // palettes, `:root` and `.app-scope` define the SAME colours, so a portal
    // that escapes the scope now inherits an identical palette. The colour half
    // of #116 is structurally fixed, not merely unbroken.
    //
    // The FONT is not. `--font-golos` is mounted by next/font on the layout
    // element and exists nowhere in `:root`, so an escaped portal silently falls
    // back to the default sans — exactly what #116 also reported. That is the
    // half a check can still fail on, so this is where the check goes.
    const scopeFont = getComputedStyle(scope).fontFamily;
    for (const el of overlays) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) continue;
      const font = getComputedStyle(el).fontFamily;
      if (font === scopeFont) continue;
      faults.push({
        kind: "ESCAPED-SCOPE",
        what: `${el.tagName.toLowerCase()} font`,
        detail:
          `font-family is ${font}, but the app scope renders ${scopeFont}. ` +
          `A portal outside .app-scope cannot see --font-golos, so it falls back ` +
          `to the default sans (#116). Check PortalScope.`,
      });
    }
  }

  // 2) TEXT BELOW ITS THRESHOLD, against what is really behind it.
  for (const el of document.querySelectorAll("body *")) {
    // Only elements holding their own visible text.
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join("");
    if (own.length < 2) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") continue;
    if (parseFloat(style.opacity) < 0.5) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;

    const fg = parse(style.color);
    const bg = backdrop(el);
    if (!fg || !bg) continue;
    const composited = fg.a < 0.999 ? over(fg, bg) : fg;

    // WCAG large text: >=24px, or >=18.66px bold.
    const size = parseFloat(style.fontSize);
    const weight = parseInt(style.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const floor = large ? 3 : 4.5;
    const r = ratio(composited, bg);
    if (r >= floor) continue;

    const key = `${el.tagName}|${style.color}|${own.slice(0, 24)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    faults.push({
      kind: "CONTRAST",
      what: `${el.tagName.toLowerCase()} “${own.slice(0, 44)}”`,
      detail:
        `${r.toFixed(2)}:1 (needs ${floor}:1) — ${style.color} on ` +
        `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)}), ` +
        `${size}px/${weight}`,
    });
  }
  return faults;
};

/* ------------------------------------------------------------------------- */

if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });

const browser = await chromium.launch();

async function login(context) {
  const page = await context.newPage();
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.$eval("form", (f) => f.requestSubmit());
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
  await context.storageState({ path: STATE_FILE });
  await page.close();
}

const wanted = SURFACES.filter((s) => !publicOnly || !s.auth);
const needsAuth = wanted.some((s) => s.auth);

for (const theme of ["light", "dark"]) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: theme,
  });
  await context.addInitScript((t) => {
    try {
      window.localStorage.setItem("theme", t);
    } catch {}
  }, theme);
  if (needsAuth) await login(context);

  for (const surface of wanted) {
    const page = await context.newPage();
    try {
      await page.goto(`${base}${surface.path}`, { waitUntil: "networkidle", timeout: 45_000 });
      if (surface.auth && new URL(page.url()).pathname.startsWith("/login")) {
        problems.push({
          theme,
          surface: surface.label,
          kind: "AUTH",
          what: surface.path,
          detail: "bounced to /login — the audit never saw the authenticated surface",
        });
        await page.close();
        continue;
      }
      // Open the overlay this surface exists to audit. The selector list is
      // tried in order because the trigger's accessible name is the thing most
      // likely to be renamed, and a missed click has to be LOUD rather than a
      // silent pass over a surface that never opened.
      if (surface.open) {
        let opened = false;
        for (const selector of surface.open) {
          if (selector === "__cmdk__") {
            await page.keyboard.press("ControlOrMeta+k");
          } else {
            const target = page.locator(selector).first();
            if ((await target.count()) === 0) continue;
            await target.click({ timeout: 5_000 }).catch(() => {});
          }
          await page.waitForTimeout(600);
          if ((await page.locator('[role="dialog"],[role="menu"]').count()) > 0) {
            opened = true;
            break;
          }
        }
        if (!opened) {
          problems.push({
            theme,
            surface: surface.label,
            kind: "NOT-OPENED",
            what: surface.open.join(" | "),
            detail:
              "no trigger matched, so this surface was never rendered. That is a " +
              "failure, not a skip: a check that silently audits nothing is worse " +
              "than no check.",
          });
          await page.close();
          continue;
        }
      }
      await page.waitForTimeout(400);
      const faults = await page.evaluate(AUDIT);
      for (const fault of faults) problems.push({ theme, surface: surface.label, ...fault });
    } catch (error) {
      problems.push({
        theme,
        surface: surface.label,
        kind: "ERROR",
        what: surface.path,
        detail: String(error?.message ?? error),
      });
    }
    await page.close();
  }
  await context.close();
}

await browser.close();

/* ------------------------------------------------------------------------- */

const audited = wanted.length * 2;
if (!problems.length) {
  console.log(`theme-audit: ${audited} surface/theme combinations, no faults.`);
  process.exit(0);
}

console.error(`\ntheme-audit: ${problems.length} fault(s) across ${audited} surface/theme combinations\n`);
for (const kind of ["ERROR", "AUTH", "EMPTY", "NOT-OPENED", "ESCAPED-SCOPE", "CONTRAST"]) {
  const group = problems.filter((p) => p.kind === kind);
  if (!group.length) continue;
  console.error(`── ${kind} ─────────────────────────────────────────────`);
  for (const p of group) {
    console.error(`  [${p.theme}] ${p.surface}\n    ${p.what}\n    ${p.detail}`);
  }
  console.error("");
}
console.error(
  "A colour that is legal in the token file can still fail here: this measures " +
    "what the browser actually painted, which is where #116 lived.\n",
);
process.exit(1);
