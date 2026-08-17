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
  // #286: the joining orientation a new member sees on first sign-in, and the
  // notification primer that replaced the cold OS prompt on both phones. All
  // three, because the whole point of the issue is that a tech is a phone-first
  // reader who may have been handed a laptop instead.
  { key: "onboarding", web: "onboarding", android: "onboarding", ios: "Onboarding" },

  // ---- deliberate asymmetries, each with its reason -----------------------
  {
    key: "public",
    // #294 — the job photo page a HOMEOWNER opens, and the first surface in
    // this product built for a customer's customer (D75).
    //
    // Web-only by nature rather than by omission. The person opening it has no
    // account, has never heard of us, and tapped a link in a text message from
    // their plumber. Asking them to install an app to look at photos of their
    // own boiler is the opposite of the point; a URL is the whole delivery
    // mechanism.
    //
    // The phones are not missing anything here: they mint and revoke the link
    // from the task screen, which is the crew-facing half and IS on all three.
    // What lives in this directory is only what the customer's browser renders.
    //
    // If a native "view my job" experience is ever wanted, it belongs to a
    // different question — whether homeowners get an app at all — and not to
    // this directory.
    web: "public",
    android: null,
    androidReason:
      "the page is opened by the customer's customer in a browser from a texted link; a homeowner installs nothing",
    ios: null,
    iosReason:
      "the page is opened by the customer's customer in a browser from a texted link; a homeowner installs nothing",
  },
  {
    key: "security",
    // #330 — the app lock, and the asymmetry is the point rather than a gap.
    //
    // D12's customer is a crew texting from PERSONAL handsets: the tech's own
    // phone, carried off-shift, with a spare in the truck that gets handed to
    // whoever is covering the weekend. That handover is what the lock is for, and
    // it is a phone-shaped problem.
    //
    // Web is absent DELIBERATELY, for two reasons rather than one. A tab cannot
    // enforce a lock — another tab, the back button or view-source walks past
    // anything a page draws, so a browser "app lock" would be the false promise
    // this feature refuses to make on a phone with no passcode. And the machine
    // it would run on is a laptop or desk PC, where the boundary is the OS login
    // and the session that #236 can already revoke remotely.
    //
    // If the shared-laptop case ever turns out to be real, the honest answer is
    // a shorter session, not a drawn lock — and that belongs to #236, not here.
    web: null,
    webReason:
      "a tab cannot enforce a lock (another tab walks past it); the boundary on a laptop is the OS login plus #236 remote session revocation",
    android: "security",
    ios: "Security",
  },
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
    key: "a11y",
    // #238 — a Radix overlay marks everything behind it `aria-hidden` and
    // leaves it in the TAB ORDER: focusable and unannounceable at once. This
    // directory holds the one component that makes that subtree `inert` too.
    //
    // WEB-ONLY BECAUSE IT IS A WEB PROBLEM. Neither phone can reproduce it: a
    // Compose `ModalBottomSheet`/`Dialog` and a SwiftUI `.sheet` both take
    // modality from the framework — content behind is not focusable, and
    // TalkBack and VoiceOver both scope themselves to the presented surface by
    // construction. There is nothing for the phones to port; a file here would
    // be a fix for a defect they do not have.
    web: "a11y",
    android: null,
    androidReason: "Compose modals are modal by construction — background is not focusable and TalkBack scopes to the sheet",
    ios: null,
    iosReason: "SwiftUI .sheet/.fullScreenCover are modal by construction — VoiceOver scopes to the presented surface",
  },
  {
    key: "payments",
    // #224 — text-to-pay: the crew asks a customer for money, and the owner
    // connects the Stripe account that receives it.
    //
    // The capability IS on all three, and this entry exists to say where it
    // lives on each rather than to record a gap.
    //
    // What is in the directory differs by client, and the difference is real
    // rather than tidy. iOS puts all four files under Features/Payments. Android
    // keeps the ported vocabulary and the repository there and leaves the three
    // UI files beside their siblings — settings/PaymentsSection.kt next to
    // BillingSection.kt, thread/PaymentStrip.kt next to ScheduledStrip.kt —
    // because neither is a full screen there (#200 forbids the hosted settings
    // card a title or a back button) and because HostHeaderLintTest only walks
    // features/settings. Web has no package at all: the same two halves are
    // settings/payments-card.tsx and thread/ask-for-payment.tsx +
    // thread/payment-strip.tsx, inside the surfaces that own their context.
    //
    // The CUSTOMER's payment page is deliberately not here. It belongs to
    // `public` above, for exactly the reason recorded there: a homeowner who
    // tapped a link in a text installs nothing.
    web: null,
    webReason:
      "the two halves are settings/payments-card.tsx and thread/ask-for-payment.tsx + thread/payment-strip.tsx; the customer's page is under `public`",
    android: "payments",
    ios: "Payments",
  },
  {
    key: "quotes",
    // #287 — a quote is a thing rather than a paragraph typed into a text: an
    // amount, what the work is, a deadline, and a status that changes without
    // anybody in the workspace doing anything.
    //
    // All three can quote a job. Web shipped first and the phones had nothing
    // at all, which was the wrong way round for this product — a crew member
    // quotes from the van, not from a laptop — so Android followed, then iOS.
    //
    // Where it lives differs the same way payments does, and for the same
    // reasons. Android keeps the wire shapes and the ported status rule in
    // features/quotes and puts the strip beside its siblings in
    // thread/ThreadQuotes.kt, because it is not a full screen. Web has no
    // package: thread/quote-strip.tsx sits inside the surface that owns its
    // context.
    //
    // The CUSTOMER's quote page is deliberately not here. It belongs to
    // `public` above, for the reason recorded there: a homeowner who tapped a
    // link in a text installs nothing.
    web: null,
    webReason:
      "the crew half is thread/quote-strip.tsx; the customer's page is under `public`",
    android: "quotes",
    ios: "Quotes",
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
    // Picking and rendering files. On mobile the PICKING is inside the composer
    // and the thread timeline rather than its own package — but #240 gave this
    // directory a second job on the phones: generating the bounded preview that
    // uploads beside the original, which is pure image arithmetic belonging to
    // neither screen. Web keeps its equivalent in `lib/attachments/` because
    // `components/` there is for components.
    web: "attachments",
    android: "attachments",
    ios: "Attachments",
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
    key: "scheduled",
    // #233's workspace-level view: every text queued to go out, across the
    // whole crew. The CAPABILITY is on all three; only web makes it a surface.
    //
    // Web has an address bar and a rail, so it is a page — /scheduled, reached
    // from the sidebar, the palette, and the mobile account sheet. Both phones
    // reach the same list from the inbox header, as a sheet that appears only
    // when something IS queued: the tab bars are a shipped four links + avatar
    // (#100 on web, the pager on Android), and a fifth destination for a screen
    // opened a few times a month would cost every other trip through the app.
    //
    // The per-thread half is not here at all on any client — it is the strip
    // above the composer, which is thread/ by definition.
    web: "scheduled",
    android: null,
    androidReason: "the workspace list is inbox/ScheduledSheet.kt off the inbox header; the per-thread strip is thread/ScheduledStrip.kt",
    ios: null,
    iosReason: "the workspace list is Inbox/ScheduledSheet.swift off the inbox header; the per-thread strip is Thread/ScheduledStrip.swift",
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

/**
 * Capabilities that live as a FILE inside an existing surface.
 *
 * WHY THIS SECOND REGISTRY EXISTS. The directory diff above says of itself that
 * it "cannot prove a capability is IMPLEMENTED, only that somebody decided", and
 * there is a whole class it cannot even see: a capability that is one card inside
 * `settings/` on every client adds no directory anywhere, so all three could be
 * missing it and this check would report perfect parity.
 *
 * #288 is that class, and it is the case that proved the gap: referrals shipped
 * complete on the server, the reward paid out, and NEITHER PHONE had a referral
 * surface at all. Nothing failed. Nothing could have.
 *
 * So a capability that lives in a file names its file on each client, and the
 * same rule applies — a path, or a reason. Deliberately a short list rather than
 * an inventory of every component: this is for capabilities a customer would
 * name, where "web has it and the phones do not" is a defect rather than a
 * layout decision.
 */
const FILES = [
  {
    key: "referrals",
    // #288/#399 — the referral link, the editable draft and the OS share sheet.
    // A card inside each client's settings surface rather than a feature of its
    // own: the reward is a month off the invoice, so it belongs beside billing,
    // and billing itself is already a section on the phones.
    web: "apps/web/src/components/settings/referral-share.tsx",
    android:
      "apps/android/app/src/main/kotlin/com/loonext/android/features/settings/ReferralShareBlock.kt",
    ios: "apps/ios/Loonext/Features/Settings/ReferralShareBlock.swift",
  },
  {
    key: "referral-ask",
    // #288 — the moment: the ask on the home surface once the product has
    // demonstrably worked for this crew. Separate from the card above because
    // they can be built independently, and on web one of them existed for
    // months while the other did not.
    web: "apps/web/src/components/for-you/referral-ask.tsx",
    android:
      "apps/android/app/src/main/kotlin/com/loonext/android/features/foryou/ReferralAskCard.kt",
    ios: "apps/ios/Loonext/Features/ForYou/ReferralAskCard.swift",
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

// --- 3. Capabilities that live in a file, not a directory ------------------
// See FILES above: the case a directory diff structurally cannot see.
for (const capability of FILES) {
  for (const client of CLIENTS) {
    const path = capability[client];
    if (path === null || path === undefined) {
      if (!capability[`${client}Reason`]) {
        fail(
          `${capability.key}: absent on ${client} with no reason. ` +
            `Say why — "not applicable" is a fine answer, silence is not.`,
        );
      }
      continue;
    }
    if (!existsSync(path)) {
      fail(
        `${capability.key}: ${path} does not exist on ${client}. ` +
          `Either it was never built there, or it moved and this line went stale.`,
      );
    }
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
    `asymmetries. Plus ${FILES.length} file-level capabilities.`,
);
