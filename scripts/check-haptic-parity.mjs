#!/usr/bin/env node
/**
 * [#556] The two phones agree about which surfaces you can FEEL.
 *
 * ## What this found on its first run
 *
 * Android called its semantic `Haptics` 362 times across 47 files. iOS called
 * nothing, anywhere — on the platform whose haptic engine is the one people can
 * actually tell apart, and where Apple's own guidance treats feedback as part
 * of the interaction rather than as decoration. Nothing was broken, no test was
 * red, and the two apps had been through a 35-gap parity audit that did not
 * look for this: an absent buzz is invisible to every check that reads output.
 *
 * ## Why a LEDGER rather than a pass/fail
 *
 * The gap is 47 files wide and closing it in one change would mean 47 files of
 * unverifiable Swift in a single diff, on a platform that only compiles in CI.
 * So this is the shape `check-hardcoded-strings.mjs` already uses here: a
 * recorded list that may only SHRINK. A feature area that is silent on iOS
 * today is listed with the Android file count behind it; a NEW silent area
 * fails the build, and an area that has since been covered fails too until it
 * is removed from the ledger.
 *
 * The second half matters as much as the first. A ledger nobody prunes becomes
 * a list of things that are fine, and then a new gap hides among them.
 *
 * ## What it deliberately does NOT check
 *
 * Call COUNTS. Android's `Composer.kt` fires 15 times and the iOS twin fires
 * once at the send, and that is not a defect — Compose and SwiftUI draw the
 * same surface with different numbers of buttons, and a count comparison would
 * demand parity in a number that has no meaning. What matters is whether a
 * crew member gets physical confirmation on a surface at all.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ANDROID_ROOT = "apps/android/app/src/main/kotlin/com/loonext/android/features";
const IOS_ROOT = "apps/ios/Loonext/Features";
const ANDROID_HAPTICS =
  "apps/android/app/src/main/kotlin/com/loonext/android/ui/common/Haptics.kt";
const IOS_HAPTICS = "apps/ios/Loonext/Core/Haptics.swift";

/**
 * Android feature directory → iOS feature directory.
 *
 * Written out rather than derived by casing, because the two trees do not name
 * everything the same way and a silent mismatch would read as "covered".
 */
/*
 * THIS NAMED ELEVEN OF SEVENTEEN, and nothing compared it to the tree.
 *
 * `attachments`, `auth`, `onboarding`, `payments`, `quotes` and `security` were
 * outside the guard's field of view entirely — the loop below iterates this
 * object, so an area missing from it is not checked, not reported, and not
 * counted in the "0 iOS area(s) still silent" line the guard prints.
 *
 * The three consistency checks that existed all ran in the harmless direction
 * (a ledger entry must be a known area; an area must not be in two lists), so
 * none could notice a directory in neither. The assertion below runs the other
 * way: every directory under the Android features root must be mapped here or
 * declared Android-only, and every name here must be a real directory.
 */
const AREAS = {
  attachments: "Attachments",
  auth: "Auth",
  calls: "Calls",
  compose: "Compose",
  contacts: "Contacts",
  diagnostics: "Diagnostics",
  foryou: "ForYou",
  inbox: "Inbox",
  notifications: "Notifications",
  onboarding: "Onboarding",
  payments: "Payments",
  quotes: "Quotes",
  security: "Security",
  settings: "Settings",
  shell: "Shell",
  tasks: "Tasks",
  thread: "Thread",
};

/**
 * Areas iOS is still silent on, with the number of Android files that speak.
 *
 * MAY ONLY SHRINK. Delete an entry when the iOS surface starts firing; the
 * guard fails if a listed area turns out to be covered, so the list cannot rot
 * into decoration.
 */
const SILENT_ON_IOS = {
  // `contacts` left on 2026-08-14, and with it the LAST entry: a merge and an
  // import both confirm(), because each is a change that lands while somebody
  // is looking somewhere else and neither can be undone.
  //
  // The object is now empty, which is the state this ledger was written to
  // reach rather than a sign it stopped working — every removal here was a
  // real iOS surface being wired, which is the only way the guard permits one.
  // `diagnostics` left on 2026-08-14: sharing a report taps, and both clears
  // reject, matching what Android already did with the same two actions.
  // `notifications` left on 2026-08-14: the preference toggles, the retry and
  // the on-call silence confirm all fire now — the last a reject(), because it
  // is the one press on that screen somebody can regret.
  // `settings` left on 2026-08-14: #232's website-widget card is the first iOS
  // settings surface to fire, so the area is no longer silent and the guard
  // refuses the entry. That is the ledger working — it shrank because a real
  // surface was wired, which is the only way it is allowed to change.
};

/**
 * Android directories with no iOS twin, and therefore nothing to compare.
 *
 * This held `"apps"`, and there is no `features/apps` directory — so the entry,
 * and the loop that read it, guarded nothing. That is the tell that the roster
 * had drifted from the tree.
 *
 * Empty is the honest state today: every Android feature directory has an iOS
 * counterpart. The set stays because the NEXT Android-only area needs a place
 * to be declared rather than silently omitted, and the check below refuses an
 * entry that names a directory which does not exist.
 */
const ANDROID_ONLY = new Set([]);

const problems = [];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (statSync(full).isFile()) out.push(full);
  }
  return out;
}

/** Files under `dir` whose source calls the semantic haptics of `platform`. */
function speakingFiles(dir, pattern, extension) {
  return walk(dir).filter(
    (path) => path.endsWith(extension) && pattern.test(readFileSync(path, "utf8")),
  );
}

// --- Both platforms declare the same five verbs -----------------------------
//
// The vocabulary is the whole point: a surface that calls `confirm` on one
// phone and `tap` on the other is two products describing one act differently.

function verbs(source, pattern) {
  return new Set([...source.matchAll(pattern)].map((match) => match[1]));
}

const androidVerbs = verbs(
  readFileSync(ANDROID_HAPTICS, "utf8"),
  /\n    fun (\w+)\(/g,
);
const iosVerbs = verbs(
  readFileSync(IOS_HAPTICS, "utf8"),
  /\n    static func (\w+)\(/g,
);
// `prepare` is an iOS-only warm-up: Android's View.performHapticFeedback needs
// no engine spin-up, so there is nothing for it to mirror.
iosVerbs.delete("prepare");

for (const verb of androidVerbs) {
  if (!iosVerbs.has(verb)) {
    problems.push(
      `Android's Haptics speaks "${verb}" and iOS does not. One phone would ` +
        `have a word for an act the other cannot express.`,
    );
  }
}
for (const verb of iosVerbs) {
  if (!androidVerbs.has(verb)) {
    problems.push(`iOS's Haptics speaks "${verb}" and Android does not.`);
  }
}
if (androidVerbs.size === 0 || iosVerbs.size === 0) {
  problems.push(
    "cannot parse the haptic verbs from one of the two modules — this guard " +
      "has lost its subject and is no longer checking anything.",
  );
}

// --- And every area that speaks on one phone speaks on the other ------------

for (const [android, ios] of Object.entries(AREAS)) {
  const androidFiles = speakingFiles(
    join(ANDROID_ROOT, android),
    /rememberHaptics\(\)/,
    ".kt",
  );
  if (androidFiles.length === 0) continue;

  const iosFiles = speakingFiles(join(IOS_ROOT, ios), /\bHaptics\.\w+\(/, ".swift");
  const listed = SILENT_ON_IOS[android];

  if (iosFiles.length === 0) {
    if (listed === undefined) {
      problems.push(
        `Android's "${android}" fires haptics in ${androidFiles.length} file(s) ` +
          `and iOS's "${ios}" fires none. Either wire the iOS surface, or add ` +
          `"${android}: ${androidFiles.length}" to SILENT_ON_IOS with a reason ` +
          `— a new silent area is a regression, not a backlog item.`,
      );
    }
    continue;
  }

  if (listed !== undefined) {
    problems.push(
      `"${android}" is listed as silent on iOS, and ${ios} now fires haptics ` +
        `in ${iosFiles.length} file(s). Remove it from SILENT_ON_IOS. A ledger ` +
        `nobody prunes becomes a list of things that are fine, and the next ` +
        `real gap hides among them.`,
    );
  }
}

for (const android of Object.keys(SILENT_ON_IOS)) {
  if (!(android in AREAS)) {
    problems.push(
      `SILENT_ON_IOS names "${android}", which is not an area this guard maps. ` +
        `A ledger entry for a directory that does not exist covers nothing.`,
    );
  }
}

/*
 * THE ROSTER AGAINST THE TREE, in both directions.
 *
 * Every check above this point runs inside the roster: they ask whether a
 * ledger entry names a mapped area, or whether an area sits in two lists. None
 * of them can see a directory that is in NEITHER list, which is how six real
 * feature areas stayed outside this guard while it reported a clean count.
 *
 * A guard that walks a tree has to be told when the tree grows. This is that.
 */
const onDisk = readdirSync(ANDROID_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

if (onDisk.length === 0) {
  problems.push(
    `no feature directories found under ${ANDROID_ROOT} — this guard has lost ` +
      "its subject, and every count it prints below is over nothing.",
  );
}

const unmapped = onDisk.filter(
  (dir) => !(dir in AREAS) && !ANDROID_ONLY.has(dir),
);
if (unmapped.length > 0) {
  problems.push(
    `these Android feature areas are in neither AREAS nor ANDROID_ONLY, so ` +
      `nothing compares their haptics to iOS: ${unmapped.join(", ")}. Map each ` +
      `to its iOS directory, or declare it Android-only with a reason.`,
  );
}

const phantom = [...Object.keys(AREAS), ...ANDROID_ONLY].filter(
  (dir) => !onDisk.includes(dir),
);
if (phantom.length > 0) {
  problems.push(
    `these names are rostered and are not directories: ${phantom.join(", ")}. ` +
      `An entry for a directory that does not exist reads as coverage and is ` +
      `none — ANDROID_ONLY held "apps" on exactly those terms.`,
  );
}

for (const android of ANDROID_ONLY) {
  if (android in AREAS) {
    problems.push(
      `"${android}" is in both AREAS and ANDROID_ONLY — one of them is wrong.`,
    );
  }
}

if (problems.length > 0) {
  console.error("Haptics must mean the same thing on both phones (#556):\n");
  for (const problem of problems) console.error(`  - ${problem}\n`);
  process.exit(1);
}

const remaining = Object.values(SILENT_ON_IOS).reduce((a, b) => a + b, 0);
console.log(
  `Haptics: ${androidVerbs.size} verbs matched across both phones. ` +
    `${Object.keys(SILENT_ON_IOS).length} iOS area(s) still silent ` +
    `(${remaining} Android file(s) behind them).`,
);
