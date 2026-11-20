/** Route discovery and seeded browser states for the theme and axe audits. */
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { CUSTOMER_SURFACES, ONBOARDING_AUDIT_USER } from "./audit-customer-fixtures.mjs";

const APP_ROOT = fileURLToPath(new URL("../apps/web/src/app/(app)", import.meta.url));
const THREAD_ID = "b0000000-0000-4000-8000-000000000001";
const THREAD = `/inbox/${THREAD_ID}`;
const TASK_ID = "e0000000-0000-4000-8000-000000000001";
const TASK_VIEW_ID = "e1000000-0000-4000-8000-000000000001";
const SEEDED = {
  "[conversationId]": THREAD_ID,
  "[id]@contacts": "a0000000-0000-4000-8000-000000000001",
  "[id]@tasks": TASK_ID,
  "[sessionId]": "seed-call-1",
  "[viewId]@views": TASK_VIEW_ID,
};
const MIN_APP_ROUTES = 39;
const MIN_AUDIT_SURFACES = 66;
const SURFACE_OPEN_TIMEOUT_MS = 5000;

export function appRoutes() {
  const routes = [];
  const skipped = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "page.tsx") {
        const parts = relative(APP_ROOT, dir).split(/[\\/]/).filter(Boolean);
        const resolved = parts.map((part, index) => {
          if (!part.startsWith("[")) return part;
          return SEEDED[part] ?? SEEDED[`${part}@${parts[index - 1]}`] ?? null;
        });
        if (resolved.includes(null)) skipped.push(`/${parts.join("/")}`);
        else routes.push(`/${resolved.join("/")}`);
      }
    }
  }
  walk(APP_ROOT);
  return { routes: routes.toSorted((a, b) => a < b ? -1 : Number(a > b)), skipped: skipped.toSorted((a, b) => a < b ? -1 : Number(a > b)) };
}

const fixedSurfaces = [
  // Marketing: its own palette, its own scope, and newly dark (#362 phase 8).
  { path: "/", label: "marketing home", auth: false },
  { path: "/pricing", label: "marketing pricing", auth: false },
  // #228: the French site is real routes (D138), so it is audited as its own
  // pages. A screen reader, a contrast pair or a layout that works in English
  // can still fail in French: the words are longer and the document says
  // lang="fr-CA".
  { path: "/fr", label: "marketing home (fr-CA)", auth: false },
  { path: "/fr/tarifs", label: "marketing pricing (fr-CA)", auth: false },
  // The form page and the page that makes the accessibility claims.
  { path: "/contact", label: "marketing contact (form)", auth: false },
  { path: "/legal/accessibility", label: "accessibility statement", auth: false },
  { path: "/fr/accessibilite", label: "accessibility statement (fr-CA)", auth: false },
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
    desktopOnly: true,
    // The see-through account surface IS the #116 bug. Opening it is the point:
    // this is the one entry here that audits a subtree rendered OUTSIDE
    // `.app-scope`, which is the only place the cascade fault can happen.
    // Found by role and name: the trigger is named by the member it shows,
    // then "Account and settings".
    open: ["role=button[name=/Account and settings$/]"],
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
  { path: "/lou", label: "Lou overview", auth: true },
  {
    path: "/lou",
    label: "Lou activity",
    auth: true,
    open: ['role=radio[name="Activity"]'],
    ready: 'role=combobox[name="Phone line"]',
  },
  { path: "/tasks", label: "tasks", auth: true },
  {
    path: `/tasks/views/${TASK_VIEW_ID}`,
    label: "saved task view",
    auth: true,
    ready: 'role=heading[name="Service task board"]',
  },
  // #238: the rest of the daily path. Each of these failed WCAG A or AA the
  // first time it was looked at, which is the argument for looking.
  { path: "/calls", label: "calls", auth: true },
  {
    path: "/calls",
    label: "calls · dialer (portal)",
    auth: true,
    open: ["role=button[name=/^Dial$/]"],
  },
  { path: "/contacts", label: "contacts", auth: true },
  // #714: the page whose hidden date label stretched the document.
  {
    path: "/contacts/a0000000-0000-4000-8000-000000000001",
    label: "contact (the seeded first contact)",
    auth: true,
  },
  {
    path: "/inbox/b0000000-0000-4000-8000-000000000001",
    label: "thread (the seeded showcase conversation)",
    auth: true,
  },
  {
    path: "/inbox/b0000000-0000-4000-8000-000000000005",
    label: "thread (urgent, tagged and blocked)",
    auth: true,
  },
  { path: "/settings/team", label: "settings · team", auth: true },
  {
    path: "/tasks",
    label: "new task dialog",
    auth: true,
    open: ['role=button[name="New task"]'],
    ready: 'role=dialog[name="New task"]',
  },
  {
    path: "/contacts",
    label: "new contact dialog",
    auth: true,
    open: ['role=button[name="New contact"]'],
    ready: 'role=dialog[name="New contact"]',
  },
  {
    path: "/calls",
    label: "dialer",
    auth: true,
    open: ['role=button[name="Dial"]'],
    ready: 'role=dialog[name="Dial a number"]',
  },
  {
    path: `/tasks?task=${TASK_ID}`,
    label: "task details drawer",
    auth: true,
    ready: 'role=dialog[name="Task details"]',
  },
  {
    path: THREAD,
    label: "conversation actions",
    auth: true,
    open: ['role=button[name="More actions"]'],
    ready: '[role="menu"]',
  },
  {
    path: THREAD,
    label: "conversation attachments",
    auth: true,
    open: ['role=button[name="More actions"]', 'role=menuitem[name="View attachments"]'],
    ready: 'role=dialog[name="Attachments"]',
  },
  {
    path: "/onboarding/name",
    label: "onboarding company name",
    auth: true,
    onboarding: true,
    ready: "role=heading[name=/company called/]",
  },
  {
    path: "/calls",
    label: "incoming softphone call",
    auth: true,
    incomingCall: true,
    ready: 'role=button[name="Answer"]',
  },
];

const { routes, skipped } = appRoutes();
export const SURFACES = [
  ...fixedSurfaces,
  ...CUSTOMER_SURFACES,
  ...routes.filter((path) => !fixedSurfaces.some((surface) => surface.path === path))
    .map((path) => ({ path, label: path, auth: true })),
];

export async function navigateToAuditSurface(page, base, surface, timeout) {
  if (surface.incomingCall) {
    await page.route("**/v1/webrtc/token", (route) => route.fulfill({
      json: { token: "local-audit", sip_username: "audit", expires_in_hours: 1 },
    }));
  }
  // Background requests can keep running after public pages have rendered.
  return page.goto(`${base}${surface.path}`, {
    waitUntil: surface.auth ? "networkidle" : "load",
    timeout,
  });
}

export function selectAuditSurfaces({ publicOnly, authedOnly }) {
  return SURFACES.filter((surface) => {
    const requiresLocalStack = surface.auth || surface.localOnly;
    if (publicOnly) return !requiresLocalStack;
    if (authedOnly) return requiresLocalStack;
    return true;
  });
}

function sessionOf(surface) {
  if (surface.onboarding) return "onboarding";
  return surface.auth ? "workspace" : "anonymous";
}

export async function createAuditContexts(browser, surfaces, options, { login, configure }) {
  const contexts = new Map();
  const sessionTypes = new Set(surfaces.map(sessionOf));
  for (const session of sessionTypes) {
    const context = await browser.newContext(options);
    await configure?.(context);
    if (session !== "anonymous") {
      const email = session === "onboarding" ? ONBOARDING_AUDIT_USER.email : undefined;
      await login(context, email);
    }
    contexts.set(session, context);
  }
  return {
    forSurface: (surface) => contexts.get(sessionOf(surface)),
    close: () => Promise.all([...contexts.values()].map((context) => context.close())),
  };
}

export function auditCoverage() {
  const count = SURFACES.length;
  console.log(`audit-surfaces: ${count} surfaces covering ${routes.length} app routes`);
  if (skipped.length > 0) {
    throw new Error(`Missing test IDs for app routes: ${skipped.join(", ")}`);
  }
  if (routes.length < MIN_APP_ROUTES || count < MIN_AUDIT_SURFACES) {
    throw new Error("The accessibility audit lost coverage");
  }
}

export async function openAuditSurface(page, surface) {
  if (surface.incomingCall) {
    await page.locator('html[data-audit-phone-ready="true"]').waitFor({ timeout: 10_000 });
    await page.evaluate(() => window.dispatchEvent(new Event("loonext:audit-incoming-call")));
  }
  for (const selector of surface.open ?? []) {
    await (selector === "__cmdk__"
      ? page.keyboard.press("ControlOrMeta+k")
      : page.locator(selector).first().click({ timeout: SURFACE_OPEN_TIMEOUT_MS }));
  }
  if (surface.open || surface.ready) {
    await page.locator(surface.ready ?? '[role="dialog"],[role="menu"]').first()
      .waitFor({ timeout: SURFACE_OPEN_TIMEOUT_MS });
  }
  if (surface.locale) {
    await page.locator(`main[lang="${surface.locale}"]`).waitFor({ timeout: SURFACE_OPEN_TIMEOUT_MS });
  }
}
