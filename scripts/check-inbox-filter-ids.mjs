#!/usr/bin/env node
/**
 * #548: an inbox filter is an ID. The Member/Tag object is only how that id gets
 * a name on screen.
 *
 * Both phones had it the other way round — the filter state held the resolved
 * object — so applying a saved view before `/members` and `/tags` had landed ran
 * a `find`, got nothing, and dropped the assignee and the tag. Silently: no
 * error, no chip, just a narrower list than the view says it is, and on iOS the
 * chip went unlit while the filter stayed off. A saved view is one tap on a cold
 * start, which is precisely when that race is lost.
 *
 * Two clients, hand-ported from each other, one shape of bug. So this asks both
 * of them the same two questions:
 *
 *   1. is the assignee/tag filter state a string id?
 *   2. does the saved-view apply path resolve ids through a roster lookup?
 *
 * A source check rather than a behavioural one, and worth being plain about why:
 * neither phone has a harness that can construct its inbox controller, and the
 * bug is not in a function that could be called — it is in which of two things
 * the state holds. That is a claim about the source, so it is checked in the
 * source.
 */
import { readFileSync } from "node:fs";

const CLIENTS = [
  {
    label: "Android",
    file: "apps/android/app/src/main/kotlin/com/loonext/android/features/inbox/InboxTab.kt",
    // `var assigneeUserId by mutableStateOf<String?>(null)`
    idState: [
      /var\s+assigneeUserId\s+by\s+mutableStateOf<String\?>/,
      /var\s+tagId\s+by\s+mutableStateOf<String\?>/,
    ],
    objectState: [
      /var\s+assignee\s+by\s+mutableStateOf<Member\?>/,
      /var\s+tag\s+by\s+mutableStateOf<Tag\?>/,
    ],
    applyView: /fun applyView\(view: SavedView\)\s*\{([\s\S]*?)\n    \}/,
  },
  {
    label: "iOS",
    file: "apps/ios/Loonext/Features/Inbox/InboxTab.swift",
    idState: [
      /var\s+assigneeUserId:\s*String\?/,
      /var\s+tagId:\s*String\?/,
    ],
    objectState: [
      /private\(set\)\s+var\s+assignee:\s*Member\?/,
      /private\(set\)\s+var\s+tag:\s*Tag\?/,
    ],
    applyView: /func applyView\(_ view: SavedView\)\s*\{([\s\S]*?)\n    \}/,
  },
];

/** A lookup into the roster or the tag list — the thing that loses the filter. */
const LOOKUP = /\b(?:members|allTags)\b\s*\.\s*(?:find|first)\b/;

const problems = [];

for (const client of CLIENTS) {
  let source;
  try {
    source = readFileSync(client.file, "utf8").replace(/\r\n/g, "\n");
  } catch {
    problems.push(`${client.label}: cannot read ${client.file}`);
    continue;
  }

  for (const pattern of client.idState) {
    if (!pattern.test(source)) {
      problems.push(
        `${client.label}: no id-typed filter state matching ${pattern} in ${client.file}. ` +
          `The assignee and tag filters must be stored as ids — an object cannot ` +
          `exist before the list it comes from has loaded.`,
      );
    }
  }

  for (const pattern of client.objectState) {
    if (pattern.test(source)) {
      problems.push(
        `${client.label}: filter state is holding a resolved object (${pattern}) in ${client.file}. ` +
          `That is the #548 defect: a saved view applied before the roster lands ` +
          `drops the filter. Store the id; derive the object for the label.`,
      );
    }
  }

  const body = client.applyView.exec(source);
  if (body === null) {
    // Loud rather than skipped: a guard that cannot find its subject has
    // stopped guarding, and reads exactly like one that passed.
    problems.push(
      `${client.label}: applyView not found in ${client.file} — this guard has ` +
        `lost its subject and is no longer checking anything. Fix the pattern ` +
        `(${client.applyView}) or the function it names.`,
    );
  } else if (LOOKUP.test(body[1])) {
    problems.push(
      `${client.label}: applyView resolves a saved view's ids through a roster ` +
        `lookup in ${client.file}. On a cold start that lookup returns nothing ` +
        `and the view loses its assignee and tag. Assign the ids straight across.`,
    );
  }
}

if (problems.length > 0) {
  console.error("Inbox filter state must be ids, not resolved objects (#548):\n");
  for (const problem of problems) console.error(`  - ${problem}\n`);
  process.exit(1);
}

console.log(
  `Inbox filter state: ${CLIENTS.length} clients store filters as ids and apply saved views without a lookup.`,
);
