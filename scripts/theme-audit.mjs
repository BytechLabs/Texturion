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
 *   node scripts/theme-audit.mjs --authed         # only the ones that do
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
// The public surfaces already run in the `build` job, which needs no database.
// `--authed` is the other half, so the heavier job does not repeat cheap work.
const authedOnly = args.includes("--authed");
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

/**
 * #238 — APP-LAYOUT-V2 §7, checked mechanically rather than from memory.
 *
 * §7 is a good, precise, BINDING specification that nothing verified. #238 is
 * blunt about the consequence: "a spec that is only enforced by memory decays
 * exactly like the parity in #338 did." It also says where this belongs —
 * "shared with #320's both-theme capture rather than built twice" — so it runs
 * inside the audit that already logs in, opens the overlays, and renders every
 * surface in both schemes. A second harness would be a second thing to keep
 * working.
 *
 * THREE RULES, chosen because each is written in §7 in as many words, each is
 * measurable without judgement, and each has a real regression behind it:
 *
 *   NO-NAME     An interactive control with no accessible name. §7 requires
 *               labels on the icon-only controls specifically ("Remove
 *               <filter>", the composer send button, the per-message toggle),
 *               and an icon-only button is exactly the thing that ships nameless
 *               — it looks complete on screen and is a dead end in a screen
 *               reader. Nothing else in CI would catch it.
 *   SMALL-TAP   §7: hit targets >= 44px via `.tap-target`. MEASURED AT 375px
 *               ONLY, and that qualifier is the whole check. §7's rule is
 *               mobile-first in as many words ("designed at 375px"), and
 *               `.tap-target` is `size-11 md:size-8` — 44px on a phone,
 *               deliberately smaller on a desktop where the pointer is a mouse.
 *               Running it at 1440px reported 210 faults on eight surfaces,
 *               every one of them correct-by-design: a firehose that would have
 *               been muted within a week, which #320 already warned is worse
 *               than no gate at all.
 *   NO-ALT      §7 requires alt text on every gallery thumbnail. An <img> with
 *               no alt attribute at all is the failure; alt="" is a DECLARATION
 *               that the image is decorative and is correct, so it passes.
 *
 * WHAT IT DELIBERATELY DOES NOT CHECK. Focus appearance (2.4.11) needs a
 * rendered focus ring compared against its surround, and reduced motion needs
 * a second pass under an emulated media query. Both are real and both belong
 * here later; neither is measurable in this pass without producing the kind of
 * noisy near-miss that gets a gate rubber-stamped, which #320 already warned is
 * worse than no gate at all.
 */
const A11Y = (checkTapSize) => {
  const faults = [];

  /**
   * WCAG 2.2 2.5.8 AA's normative floor, NOT §7's 44px aspiration.
   *
   * §7 asks for 44px and `.tap-target` delivers it; this gate enforces the
   * STANDARD instead, one notch below, and the difference is deliberate. The
   * country selector is the case that settled it: its author chose `min-h-6`
   * with a comment naming 2.5.8's 24px floor, because a compact segmented
   * control given 44px hit areas would have its two options OVERLAP — worse
   * for the same user. A gate that fails a considered, conformant choice is one
   * that gets argued with and then muted.
   *
   * So: 24px is the line, `.tap-target` credits anything aiming higher, and
   * §7's 44px stays what the utility exists to make easy rather than what CI
   * demands of every control.
   */
  const MIN_TARGET_PX = 24;

  /** Is this actually on screen? An offscreen control is not a user's problem. */
  const visible = (el) => {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (parseFloat(style.opacity || "1") === 0) return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  };

  /** A short, stable way to point at the offender in a failure line. */
  const describe = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className
      ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}`
      : "";
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };

  /**
   * The name a screen reader would announce, in the order it resolves them.
   * Deliberately not a full accname implementation — this needs to be right
   * about the common cases and never wrong about a control that HAS a name.
   */
  const accessibleName = (el) => {
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const text = labelledby
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .join(" ")
        .trim();
      if (text) return text;
    }
    const aria = el.getAttribute("aria-label")?.trim();
    if (aria) return aria;
    const text = el.textContent?.trim();
    if (text) return text;
    const title = el.getAttribute("title")?.trim();
    if (title) return title;
    // An icon-only control often carries its name on the image inside it.
    const img = el.querySelector("img[alt]");
    if (img?.getAttribute("alt")?.trim()) return img.getAttribute("alt").trim();
    if (el.tagName === "INPUT") {
      const placeholder = el.getAttribute("placeholder")?.trim();
      if (placeholder) return placeholder;
    }
    // `<label for>` labels any LABELABLE element — button, input, meter,
    // output, progress, select, textarea — not just inputs. Radix renders a
    // switch as `<button role="switch">`, so checking inputs alone reported
    // every correctly-labelled toggle in settings as nameless.
    const LABELABLE = ["BUTTON", "INPUT", "METER", "OUTPUT", "PROGRESS", "SELECT", "TEXTAREA"];
    if (LABELABLE.includes(el.tagName)) {
      const labelled = el.id
        ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
        : el.closest("label");
      if (labelled?.textContent?.trim()) return labelled.textContent.trim();
    }
    return "";
  };

  const interactive = document.querySelectorAll(
    'button, a[href], [role="button"], [role="tab"], [role="switch"], ' +
      'input:not([type="hidden"]), select, textarea',
  );

  for (const el of interactive) {
    if (!visible(el)) continue;
    // aria-hidden subtrees are removed from the tree a screen reader sees, so
    // a nameless control inside one is not reachable and not a fault.
    if (el.closest('[aria-hidden="true"]')) continue;

    if (!accessibleName(el)) {
      faults.push({
        kind: "NO-NAME",
        what: describe(el),
        detail:
          "interactive control with no accessible name — reachable by keyboard " +
          "and unannounceable by a screen reader (§7 roles and labels)",
      });
    }

    const box = el.getBoundingClientRect();
    // CONTROLS, NOT LINKS. §7's rule is about hit targets — it names the
    // segmented tabs, the filter chips, the composer send button, the
    // per-message toggle — and `.tap-target` is a class on buttons. Text links
    // are a different question that WCAG 2.5.8 answers differently (24px, with
    // exceptions for anything inline or adequately spaced), and applying 44px
    // to them reported every footer link on the marketing site. A gate that
    // fires on correct markup is one that gets muted.
    const isControl =
      el.tagName === "BUTTON" ||
      el.tagName === "SELECT" ||
      ["button", "tab", "switch"].includes(el.getAttribute("role") ?? "") ||
      (el.tagName === "INPUT" &&
        ["checkbox", "radio", "button", "submit"].includes(el.type));
    // Visually-hidden-until-focused controls (the skip link is 1x1 by design)
    // are not small targets, they are absent ones until they are needed.
    const hidden = box.width <= 4 || box.height <= 4;
    // `.tap-target` SATISFIES the rule even though the box stays small: the
    // utility extends the CLICKABLE area to 44px with a centred invisible
    // ::after, deliberately, so a chip keeps its visual size without a layout
    // shift. getBoundingClientRect() cannot see a pseudo-element, so measuring
    // the box alone reported every correctly-built button on the login and
    // signup screens. §7's rule is "hit targets >= 44px VIA `.tap-target`", so
    // what this looks for is a small control MISSING the mechanism.
    const hasTapTarget = el.classList.contains("tap-target");
    if (
      checkTapSize &&
      isControl &&
      !hidden &&
      !hasTapTarget &&
      (box.width < MIN_TARGET_PX || box.height < MIN_TARGET_PX)
    ) {
      faults.push({
        kind: "SMALL-TAP",
        what: `${describe(el)} ${Math.round(box.width)}x${Math.round(box.height)}`,
        detail:
          `hit target under ${MIN_TARGET_PX}px and not using \`.tap-target\` ` +
          "(WCAG 2.2 2.5.8 AA; §7 asks for 44 via the utility) — " +
          `named "${accessibleName(el).slice(0, 40)}"`,
      });
    }
  }

  for (const img of document.querySelectorAll("img")) {
    if (!visible(img)) continue;
    if (img.closest('[aria-hidden="true"]')) continue;
    // alt="" is a decision that this image is decorative, and a correct one.
    // A MISSING attribute is the fault: nobody decided.
    if (!img.hasAttribute("alt")) {
      faults.push({
        kind: "NO-ALT",
        what: describe(img),
        detail:
          "image with no alt attribute — alt=\"\" is fine and says decorative; " +
          "absent says nobody decided (§7 gallery)",
      });
    }
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

const wanted = SURFACES.filter((s) => (publicOnly ? !s.auth : authedOnly ? s.auth : true));
if (!wanted.length) {
  console.error("theme-audit: no surfaces selected — check the flags.");
  process.exit(1);
}
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
      // #238: the same rendered page, asked a different question. Run once per
      // theme like the contrast pass — a control can lose its name in one
      // scheme only (a dark-mode-only icon swap), and a check that ran once
      // would be green on the theme nobody was looking at.
      // Names and alt text, in both themes: a control can lose its name in one
      // scheme only (a dark-mode-only icon swap), and a check that ran once
      // would be green on the theme nobody was looking at. Tap size is
      // theme-independent and measured in the phone pass below instead.
      const a11y = await page.evaluate(A11Y, false);
      for (const fault of a11y) problems.push({ theme, surface: surface.label, ...fault });
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

/**
 * #238 — the phone pass, and the only place tap size is measured.
 *
 * §7 specifies 44px hit targets as a MOBILE rule ("designed at 375px"), and the
 * implementation agrees: `.tap-target` is `size-11 md:size-8`, so a control is
 * 44px on a phone and smaller on a desktop where the pointer is a mouse. The
 * rule is real; the viewport it is written for is the one that has to be
 * measured.
 *
 * ONE THEME, not two. A button's box does not change colour scheme, so a second
 * pass would double the runtime to re-measure identical numbers.
 *
 * Overlay surfaces are skipped: their triggers are laid out for a wide shell
 * and the open sequence is unreliable at 375px, so including them would report
 * NOT-OPENED noise rather than tap-size facts.
 */
{
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    colorScheme: "light",
    isMobile: true,
    hasTouch: true,
  });
  if (needsAuth) await login(context);

  for (const surface of wanted.filter((s) => !s.open)) {
    const page = await context.newPage();
    try {
      await page.goto(`${base}${surface.path}`, { waitUntil: "networkidle", timeout: 45_000 });
      if (surface.auth && new URL(page.url()).pathname.startsWith("/login")) {
        await page.close();
        continue; // already reported by the desktop pass
      }
      await page.waitForTimeout(400);
      const faults = await page.evaluate(A11Y, true);
      for (const fault of faults) {
        if (fault.kind !== "SMALL-TAP") continue; // names/alt already covered
        problems.push({ theme: "375px", surface: surface.label, ...fault });
      }
    } catch (error) {
      problems.push({
        theme: "375px",
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
// #238's kinds are listed here too. A fault collected and never printed is
// the "silently audits nothing" failure this file warns about elsewhere, and it
// would arrive as a green run with a nonzero exit nobody could explain.
for (const kind of [
  "ERROR",
  "AUTH",
  "EMPTY",
  "NOT-OPENED",
  "ESCAPED-SCOPE",
  "CONTRAST",
  "NO-NAME",
  "SMALL-TAP",
  "NO-ALT",
]) {
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
