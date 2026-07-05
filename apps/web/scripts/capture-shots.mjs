/**
 * capture-shots.mjs — real product screenshots for the marketing site.
 *
 * Drives the ACTUAL running app (real API + real seeded Supabase data) with
 * Playwright, captures each marketing surface at 2× in light and dark, then
 * post-processes every capture to a pre-sized WebP (+ AVIF) at the exact
 * display width the site uses, and writes a tiny blurred placeholder data-URI
 * per shot into the typed manifest module. No mockups, no stock: every pixel
 * is the running product showing obviously-demo data ("Mike's Plumbing").
 *
 * ── Prerequisites (all local; see docs/marketing/screenshots.md) ──────────
 *   1. Supabase up:      pnpm db:start   (once) ; pnpm db:reset
 *   2. Seed demo data:   node --experimental-strip-types scripts/dev-seed.ts
 *   3. API worker:       pnpm --filter @loonext/api exec wrangler dev --port 8787
 *   4. Web app:          pnpm --filter @loonext/web  exec next dev --port 3100
 *      (web MUST be 3100 — the API's APP_ORIGIN CORS allowlist is exact.)
 *   5. Chromium:         pnpm dlx playwright install chromium
 *
 * Then, from the repo root:
 *   node apps/web/scripts/capture-shots.mjs
 *
 * Re-runnable and idempotent: overwrites apps/web/public/shots/*.{webp,avif}
 * and regenerates apps/web/public/shots/manifest.ts. Raster work happens in a
 * throwaway dir the repo .gitignore already excludes (.next-shots/), cleaned
 * up on exit. Kill the dev servers yourself when done (this script does not
 * own them).
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(WEB_ROOT, "..", "..");
const SHOTS_DIR = join(WEB_ROOT, "public", "shots");
const WORK_DIR = join(REPO_ROOT, ".next-shots"); // gitignored (.next-*)

const BASE = process.env.SHOTS_BASE_URL ?? "http://127.0.0.1:3100";
const OWNER = { email: "owner@jobtext.test", password: "devseed1" };

// sharp lives in apps/web/node_modules; resolve it relative to this script
// (which sits under apps/web/scripts/), honouring its package exports map.
const { default: sharp } = await import("sharp");

/* ───────────────────────────── shot catalogue ───────────────────────────── */
/**
 * Each shot declares: the display width the site renders it at (the raster is
 * emitted at exactly this, from a 2× capture), the capture viewport, and a
 * `drive(page)` that leaves the page on the frame to shoot. Themes listed run
 * light and/or dark. `alt` is the honest, human alt text stored in the manifest.
 */
const DESKTOP_VP = { width: 1440, height: 900 };
const MOBILE_VP = { width: 390, height: 844 };

const SHOTS = [
  {
    id: "inbox-list",
    display: 1200,
    viewport: DESKTOP_VP,
    themes: ["light", "dark"],
    alt: "JobText shared inbox showing a list of customer text conversations with New, Open, Waiting and Closed statuses, unread markers and an assignee avatar.",
    async drive(page) {
      await gotoInbox(page);
    },
  },
  {
    id: "thread-open",
    display: 1200,
    viewport: DESKTOP_VP,
    themes: ["light", "dark"],
    alt: "An open customer conversation in JobText with inbound and outbound texts, a photo the customer sent, an internal team note, delivery states, and one message marked done.",
    async drive(page) {
      await openMarcusThread(page);
    },
  },
  {
    id: "contact-panel",
    display: 1200,
    viewport: DESKTOP_VP,
    themes: ["light", "dark"],
    alt: "A JobText conversation with the contact details panel open, showing the customer's name, number, consent record, address and notes beside the message thread.",
    async drive(page) {
      // Persist the panel-open preference before the thread mounts (G6).
      await page.addInitScript(() => {
        try {
          localStorage.setItem("jobtext:contact-panel-open", "true");
        } catch {}
      });
      await openMarcusThread(page);
      // Ensure the panel actually rendered (heading inside the panel).
      await page
        .getByRole("button", { name: /hide contact details/i })
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    },
  },
  {
    id: "mobile-inbox",
    display: 390,
    viewport: MOBILE_VP,
    themes: ["light", "dark"],
    alt: "The JobText inbox on a phone: a full-screen list of customer text conversations with statuses and unread markers, sized for one-handed use.",
    async drive(page) {
      await gotoInbox(page);
    },
  },
  {
    id: "mobile-thread",
    display: 390,
    viewport: MOBILE_VP,
    themes: ["light", "dark"],
    alt: "A customer text conversation on a phone in JobText, showing inbound and outbound messages, a photo, and delivery states in a full-screen thread.",
    async drive(page) {
      await openMarcusThread(page);
    },
  },
  {
    id: "onboarding-setting-up",
    display: 1200,
    viewport: DESKTOP_VP,
    themes: ["light", "dark"],
    alt: "The JobText onboarding screen the moment a new business number is revealed, in 36-point type with a copy button, above a checklist confirming the number is live and the inbox is ready.",
    async drive(page) {
      await login(page);
      await page.goto(`${BASE}/onboarding/setting-up`, {
        waitUntil: "networkidle",
      });
      // Wait for the revealed number (tabular reveal) to render.
      await page
        .getByText(/\(512\) 555-0100/)
        .first()
        .waitFor({ timeout: 15_000 })
        .catch(() => {});
      await page.waitForTimeout(600);
    },
  },
];

/* ───────────────────────────── driving helpers ──────────────────────────── */

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  // Already authenticated (storageState reused) → straight to the app.
  if (/\/inbox/.test(page.url())) return;
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL(/\/inbox/, { timeout: 20_000 });
}

async function gotoInbox(page) {
  await login(page);
  // Land on the bare list (never a specific thread).
  if (!/\/inbox\/?(\?|$)/.test(page.url())) {
    await page.goto(`${BASE}/inbox`, { waitUntil: "networkidle" });
  }
  // The list is loaded once a known demo contact is on screen. Generous
  // timeout: the dev server may still be compiling a route on a cold run.
  await page.getByText("Marcus Reed").first().waitFor({ timeout: 45_000 });
  await settle(page);
}

async function openMarcusThread(page) {
  await gotoInbox(page);
  // Marcus is the richest thread (note + MMS + delivery states + a done msg).
  await page.getByText("Marcus Reed").first().click();
  await page.waitForURL(/\/inbox\/[0-9a-f-]{36}/, { timeout: 15_000 });
  // Wait for the thread body: the done ("On our way now") message text.
  await page
    .getByText(/On our way now/)
    .first()
    .waitFor({ timeout: 15_000 });
  // MMS photo: wait until the attachment <img> has actually decoded so the
  // capture never catches a loading shimmer.
  await page
    .locator('img[alt*="Photo from"]')
    .first()
    .evaluate((img) => (img.complete ? true : img.decode().catch(() => {})))
    .catch(() => {});
  await settle(page);
  // Anchor to the bottom of the thread: the newest cluster carries the whole
  // required story in one frame — the struck-through done message (D14), the
  // "Delivered ✓✓" state, and the "Not delivered — Retry" failure — with the
  // internal note and MMS still in view above. The list is virtualized and
  // stick-to-bottom, so nudge it a few times until the failure row (the last
  // message) is actually on screen, then hold.
  await scrollThreadToBottom(page);
  await page.waitForTimeout(400);
}

/**
 * Force the virtualized thread to its newest message. The thread pane nests a
 * couple of `.overscroll-contain` elements; only one is actually scrollable
 * (scrollHeight > clientHeight), so pick that one and pin it to the bottom.
 * Repeat a few times because the virtualizer re-measures as rows mount.
 */
async function scrollThreadToBottom(page) {
  const pin = () =>
    page.evaluate(() => {
      const scrollers = Array.from(
        document.querySelectorAll(".overflow-y-auto"),
      ).filter((el) => el.scrollHeight - el.clientHeight > 8);
      // The thread scroller is the one holding the message rows.
      const el =
        scrollers.find((e) => e.className.includes("overscroll-contain")) ??
        scrollers[scrollers.length - 1];
      if (el) el.scrollTop = el.scrollHeight;
    });

  for (let i = 0; i < 8; i++) {
    await pin();
    await page.waitForTimeout(200);
    const atBottom = await page
      .getByText(/Total is \$180/)
      .first()
      .isVisible()
      .catch(() => false);
    if (atBottom) break;
  }
  await pin();
}

/** Let fonts, images and entry animations settle before shooting. */
async function settle(page) {
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(700);
}

/* ─────────────────────────────── capture ────────────────────────────────── */

/**
 * One capture at 2×: a fresh context pinned to the theme (localStorage +
 * prefers-color-scheme so `next-themes` in system mode resolves it), reuse the
 * signed-in storage state, drive to the frame, screenshot the full viewport.
 */
async function capture(browser, storageState, shot, theme, outPng) {
  const context = await browser.newContext({
    storageState,
    viewport: shot.viewport,
    deviceScaleFactor: 2, // 2× (VISUALS §4.1)
    colorScheme: theme,
    reducedMotion: "reduce", // freeze entry animations for a clean frame
  });
  await context.addInitScript((t) => {
    try {
      localStorage.setItem("theme", t);
    } catch {}
  }, theme);

  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  await shot.drive(page);
  await page.screenshot({ path: outPng, animations: "disabled" });
  await context.close();
}

/* ─────────────────────────── post-processing ────────────────────────────── */

/**
 * Downscale a 2× PNG to the exact display width as WebP + AVIF (zero-CLS: the
 * manifest carries the emitted width/height), and produce a 20px-wide blurred
 * placeholder as a base64 WebP data-URI.
 */
async function processShot(inPng, outBase, displayWidth) {
  const img = sharp(inPng);
  const meta = await img.metadata();
  // Capture is 2×, so intrinsic display size is half the raster.
  const height = Math.round((displayWidth / (meta.width / 2)) * (meta.height / 2));

  const resized = sharp(inPng).resize(displayWidth, height, { fit: "fill" });
  await resized
    .clone()
    .webp({ quality: 82, effort: 5 })
    .toFile(`${outBase}.webp`);
  await resized
    .clone()
    .avif({ quality: 62, effort: 5 })
    .toFile(`${outBase}.avif`);

  const blurBuf = await sharp(inPng)
    .resize(20, Math.max(1, Math.round((20 / (meta.width / 2)) * (meta.height / 2))), {
      fit: "fill",
    })
    .webp({ quality: 40 })
    .toBuffer();
  const placeholder = `data:image/webp;base64,${blurBuf.toString("base64")}`;

  return { width: displayWidth, height, placeholder };
}

/* ─────────────────────────── manifest emit ──────────────────────────────── */

function emitManifest(entries) {
  const header = `// AUTOGENERATED by apps/web/scripts/capture-shots.mjs — do not edit by hand.
// Real product screenshots of the running JobText app with seeded demo data
// ("Mike's Plumbing"). Re-run the capture script to regenerate. Each entry is a
// pre-sized WebP (with an AVIF sibling at the same path) plus intrinsic
// width/height (zero-CLS) and a tiny blurred placeholder data-URI (blur-up).
//
// Usage (VISUALS §5): render inside <Frame variant="browser|phone">, set the
// <img> width/height from the entry, loading="lazy" + decoding="async" below
// the fold, and use \`placeholder\` as the blur-up background.

export type Shot = {
  /** Path under /public — the WebP. Swap the extension for the AVIF sibling. */
  readonly src: string;
  /** Path under /public — the AVIF sibling at the same display size. */
  readonly avif: string;
  /** Intrinsic display width in CSS px (raster is exactly this wide). */
  readonly width: number;
  /** Intrinsic display height in CSS px (set both to avoid layout shift). */
  readonly height: number;
  /** Blurred low-res placeholder as a base64 data-URI (blur-up). */
  readonly placeholder: string;
  /** Honest alt text describing the real screen. */
  readonly alt: string;
  /** "light" | "dark" — pair the two per surface for theme-correct rendering. */
  readonly theme: "light" | "dark";
  /** Device framing the shot expects: "browser" (desktop) or "phone" (mobile). */
  readonly frame: "browser" | "phone";
};

export const shots = {
`;

  const body = entries
    .map((e) => {
      return `  ${JSON.stringify(e.key)}: {
    src: ${JSON.stringify(e.src)},
    avif: ${JSON.stringify(e.avif)},
    width: ${e.width},
    height: ${e.height},
    theme: ${JSON.stringify(e.theme)},
    frame: ${JSON.stringify(e.frame)},
    alt: ${JSON.stringify(e.alt)},
    placeholder: ${JSON.stringify(e.placeholder)},
  },`;
    })
    .join("\n");

  const footer = `
} as const satisfies Record<string, Shot>;

export type ShotKey = keyof typeof shots;

/** All shots for a surface id, keyed by theme (e.g. shotPair("inbox-list")). */
export function shotPair(id: string): { light?: Shot; dark?: Shot } {
  const pair: { light?: Shot; dark?: Shot } = {};
  for (const shot of Object.values(shots)) {
    if (shot.src.includes(\`/\${id}.\`) || shot.src.includes(\`/\${id}-\`)) {
      pair[shot.theme] = shot;
    }
  }
  return pair;
}
`;

  return header + body + footer;
}

/* ─────────────────────────────── main ───────────────────────────────────── */

async function main() {
  console.log(`Capturing real product shots from ${BASE} …`);
  rmSync(WORK_DIR, { recursive: true, force: true });
  mkdirSync(WORK_DIR, { recursive: true });
  mkdirSync(SHOTS_DIR, { recursive: true });

  const browser = await chromium.launch();

  // Sign in once, reuse the cookie session for every capture.
  const authCtx = await browser.newContext({ viewport: DESKTOP_VP });
  const authPage = await authCtx.newPage();
  await login(authPage);
  const storageState = await authCtx.storageState();
  await authCtx.close();

  const entries = [];
  for (const shot of SHOTS) {
    for (const theme of shot.themes) {
      const name = `${shot.id}-${theme}`;
      const rawPng = join(WORK_DIR, `${name}.png`);
      process.stdout.write(`  ${name} … `);
      await capture(browser, storageState, shot, theme, rawPng);

      const outBase = join(SHOTS_DIR, name);
      const { width, height, placeholder } = await processShot(
        rawPng,
        outBase,
        shot.display,
      );
      entries.push({
        key: name,
        src: `/shots/${name}.webp`,
        avif: `/shots/${name}.avif`,
        width,
        height,
        theme,
        frame: shot.viewport === MOBILE_VP ? "phone" : "browser",
        alt: shot.alt,
        placeholder,
      });
      console.log(`✓ ${width}×${height}`);
    }
  }

  await browser.close();

  writeFileSync(join(SHOTS_DIR, "manifest.ts"), emitManifest(entries));
  console.log(`\nWrote ${entries.length} shots + manifest.ts to public/shots/`);

  rmSync(WORK_DIR, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  rmSync(WORK_DIR, { recursive: true, force: true });
  throw err;
});
