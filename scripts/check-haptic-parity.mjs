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
const AREAS = {
  calls: "Calls",
  compose: "Compose",
  contacts: "Contacts",
  diagnostics: "Diagnostics",
  foryou: "ForYou",
  inbox: "Inbox",
  notifications: "Notifications",
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
  contacts: 5,
  diagnostics: 1,
  notifications: 1,
  settings: 13,
};

/** `apps` has no iOS twin directory — its haptics live in the shell there. */
const ANDROID_ONLY = new Set(["apps"]);

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
