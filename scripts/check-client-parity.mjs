#!/usr/bin/env node
/**
 * [#338] The cheap standing parity check.
 *
 *   node scripts/check-client-parity.mjs
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS, and why it is this small.
 *
 * #198 closed as done with iOS never implemented (#337). That was the third
 * instance of one class: the 35-gap parity audit that had already been run and
 * paid for, the #257–#273 defect batch that is largely one fix ported to one
 * client, and #268 which is literally titled "iOS fix never ported".
 *
 * The structural cause is that "done" is defined per pull request rather than
 * per capability: a change lands, tests pass, the issue closes, and whether the
 * other two clients got it is nobody's checked responsibility.
 *
 * #338's own devil's advocate is the design brief: *"This is process, proposed
 * for a solo maintainer, and process invented in a backlog usually decays before
 * it pays for itself... The version most likely to survive is the smallest one:
 * a line in the issue template, and a directory diff that anyone can run. Not a
 * governance process, not a matrix document that itself goes stale."*
 *
 * So: a directory diff, in CI, with an allowlist that has to give reasons.
 *
 * ---------------------------------------------------------------------------
 * THE ONE DESIGN DECISION THAT MAKES IT WORK.
 *
 * A raw three-way diff of the feature directories is mostly NOISE. Web has
 * `billing/`, `numbers/`, `porting/`, `registration/` and `invites/` as
 * top-level components; on mobile every one of those lives inside Settings. iOS
 * has `Push/` because APNs is a platform concern. None of those are parity gaps,
 * and a check that reports them is a check that gets ignored — which #338 names
 * as the exact failure mode this backlog keeps warning about.
 *
 * So the check is not "do the directory names match". It is:
 *
 *   1. Every feature directory on every client MUST appear in SURFACES below.
 *   2. Every entry in SURFACES must say, for each of the three clients, either
 *      where it lives or WHY it is absent.
 *
 * Rule 1 is the load-bearing half. Adding `apps/ios/Loonext/Features/Whatever`
 * fails this check until somebody registers it — and registering it is exactly
 * the moment they have to answer "what do web and Android do about this?".
 * The question gets asked when the code is written rather than when an audit is
 * commissioned eighteen months later.
 *
 * It cannot prove a capability is IMPLEMENTED, only that somebody decided. That
 * is the honest limit of a directory diff, and it is still the thing that would
 * have caught #337 the day it happened.
 */
import { existsSync, readdirSync } from "node:fs";

const CLIENTS = /** @type {const} */ (["web", "android", "ios"]);

const ROOTS = {
  web: "apps/web/src/components",
  android: "apps/android/app/src/main/kotlin/com/loonext/android/features",
  ios: "apps/ios/Loonext/Features",
};

/**
 * `null` means "deliberately absent, and here is why".
 *
 * A reason is required rather than encouraged: an allowlist of bare names
 * becomes a list nobody can audit, and the whole point of recording an accepted
 * asymmetry is that the next person can tell it apart from a gap.
 */
const SURFACES = [
  // ---- shared capabilities: all three, no excuses ------------------------
  { key: "auth", web: "auth", android: "auth", ios: "Auth" },
  { key: "calls", web: "calls", android: "calls", ios: "Calls" },
  { key: "contacts", web: "contacts", android: "contacts", ios: "Contacts" },
  { key: "for-you", web: "for-you", android: "foryou", ios: "ForYou" },
  { key: "inbox", web: "inbox", android: "inbox", ios: "Inbox" },
  { key: "notifications", web: "notifications", android: "notifications", ios: "Notifications" },
  { key: "settings", web: "settings", android: "settings", ios: "Settings" },
  { key: "shell", web: "shell", android: "shell", ios: "Shell" },
  { key: "tasks", web: "tasks", android: "tasks", ios: "Tasks" },
  { key: "thread", web: "thread", android: "thread", ios: "Thread" },

  // ---- deliberate asymmetries, each with its reason -----------------------
  {
    key: "ownership",
    // #515: a nominated backup owner has to be able to ACCEPT, and the
    // confirmation used to live inside Settings > Team — a section that
    // requires team.manage, which a nominee frequently does not hold. They
    // were being asked to walk through a door locked against them.
    //
    // Web gives it its own route because a URL is how somebody arrives from
    // the email we send, and that URL must not be one the nav refuses. The
    // phones keep the prompt inside their existing settings surface: they
    // have no address bar, the nominee arrives by tapping a notification, and
    // a whole feature package for one card would be more structure than the
    // capability has.
    web: "ownership",
    android: null,
    androidReason: "the prompt lives in features/settings/OwnershipPrompt.kt — no address bar to arrive from",
    ios: null,
    iosReason: "the prompt lives in Features/Settings/OwnershipPrompt.swift — no address bar to arrive from",
  },
  {
    key: "compose",
    // The mobile clients give the message composer its own feature package
    // because it is a full screen there. On web it is a component inside the
    // thread view, which is the same capability in the layout the platform
    // wants — not a missing one.
    web: null,
    webReason: "the composer is thread/composer.tsx, not a separate surface",
    android: "compose",
    ios: "Compose",
  },
  {
    key: "diagnostics",
    // #337 built this for iOS after #198 shipped it Android-only. Web has no
    // equivalent and needs none: a browser has devtools, a network tab and a
    // console, and the whole reason this surface exists is that a phone in a
    // truck has none of those.
    web: null,
    webReason: "the browser already has devtools, a console and a network tab",
    android: "diagnostics",
    ios: "Diagnostics",
  },
  {
    key: "push",
    // APNs token lifecycle. Android's equivalent is not under features/ at all
    // (com.loonext.android.push), and web push rides the service worker.
    // Registered so the directory is not an unexplained stranger.
    web: null,
    webReason: "web push lives in the service worker, not a UI surface",
    android: null,
    androidReason: "Android's push package is outside features/ (android/push)",
    ios: "Push",
  },

  // ---- web-only, and structurally so -------------------------------------
  {
    key: "billing",
    // On mobile these are sections INSIDE Settings rather than top-level
    // surfaces — Apple and Google both dislike a payment surface that is not
    // buried, and the crew reaches them from one place anyway.
    web: "billing",
    android: null,
    androidReason: "a section inside Settings",
    ios: null,
    iosReason: "a section inside Settings",
  },
  {
    key: "numbers",
    web: "numbers",
    android: null,
    androidReason: "a section inside Settings",
    ios: null,
    iosReason: "a section inside Settings",
  },
  {
    key: "porting",
    web: "porting",
    android: null,
    androidReason: "a section inside Settings",
    ios: null,
    iosReason: "a section inside Settings",
  },
  {
    key: "registration",
    web: "registration",
    android: null,
    androidReason: "a section inside Settings",
    ios: null,
    iosReason: "a section inside Settings",
  },
  {
    key: "invites",
    web: "invites",
    android: null,
    androidReason: "accepting an invite is a link that opens the web app",
    ios: null,
    iosReason: "accepting an invite is a link that opens the web app",
  },
  {
    key: "attachments",
    // Picking and rendering files. On mobile this is inside the composer and
    // the thread timeline rather than its own package.
    web: "attachments",
    android: null,
    androidReason: "file picking lives in compose/ and thread/",
    ios: null,
    iosReason: "file picking lives in Compose/ and Thread/",
  },
  {
    key: "contact-panel",
    // The side panel beside a thread. There is no room for a side panel on a
    // phone; the same information is the contact screen.
    web: "contact-panel",
    android: null,
    androidReason: "no side panel on a phone — it is the contact screen",
    ios: null,
    iosReason: "no side panel on a phone — it is the contact screen",
  },
  {
    key: "marketing",
    // The public site. There is no mobile equivalent and there should not be.
    web: "marketing",
    android: null,
    androidReason: "the public site is web only",
    ios: null,
    iosReason: "the public site is web only",
  },
  {
    key: "brand",
    web: "brand",
    android: null,
    androidReason: "brand assets are drawables and theme code",
    ios: null,
    iosReason: "brand assets are the asset catalogue and Theme/",
  },
  {
    key: "ui",
    // Design-system primitives. Every client has these; only web keeps them
    // under the same root as its features.
    web: "ui",
    android: null,
    androidReason: "primitives live in android/ui/common, outside features/",
    ios: null,
    iosReason: "primitives live in Theme/DesignSystem.swift, outside Features/",
  },
];

let failures = 0;

function fail(message) {
  failures += 1;
  console.error(`  x ${message}`);
}

// --- 1. Every registered path actually exists ------------------------------
// A registry that names a directory nobody kept is worse than none: it reports
// parity that is not there.
for (const surface of SURFACES) {
  for (const client of CLIENTS) {
    const dir = surface[client];
    if (dir === null || dir === undefined) {
      const reason = surface[`${client}Reason`];
      if (!reason) {
        fail(
          `${surface.key}: absent on ${client} with no reason. ` +
            `Say why — "not applicable" is a fine answer, silence is not.`,
        );
      }
      continue;
    }
    if (!existsSync(`${ROOTS[client]}/${dir}`)) {
      fail(
        `${surface.key}: ${ROOTS[client]}/${dir} does not exist. ` +
          `Was it renamed, or did the surface go away?`,
      );
    }
  }
}

// --- 2. Every directory on disk is registered ------------------------------
// The load-bearing half. A new feature directory fails this check until
// somebody registers it, and registering it is the moment they have to answer
// what the other two clients do.
for (const client of CLIENTS) {
  const root = ROOTS[client];
  if (!existsSync(root)) {
    fail(`${client}: ${root} is missing — has the tree moved?`);
    continue;
  }
  const known = new Set(
    SURFACES.map((surface) => surface[client]).filter(
      (dir) => typeof dir === "string",
    ),
  );
  const onDisk = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const dir of onDisk) {
    if (known.has(dir)) continue;
    fail(
      `${client}: ${root}/${dir} is not in SURFACES. Add it to ` +
        `scripts/check-client-parity.mjs and say what the other two clients ` +
        `do about it — that question is the whole point of this check.`,
    );
  }
}

if (failures > 0) {
  console.error(
    `\n${failures} client-parity problem(s). ` +
      `#338: "done" is per capability, not per pull request.\n`,
  );
  process.exit(1);
}

const shared = SURFACES.filter((surface) =>
  CLIENTS.every((client) => typeof surface[client] === "string"),
).length;
console.log(
  `Client parity: ${SURFACES.length} surfaces registered — ` +
    `${shared} on all three clients, ${SURFACES.length - shared} with recorded ` +
    `asymmetries.`,
);
