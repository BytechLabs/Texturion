#!/usr/bin/env node
/**
 * [#427] A document's "Open, and tracked elsewhere" list has to still be true.
 *
 *   node scripts/check-open-lists.mjs
 *
 * Needs `GITHUB_TOKEN` (CI supplies it). Without one it SKIPS rather than
 * fails — a guard that cannot reach GitHub knows nothing, and reporting
 * "nothing knows nothing" as a pass would be worse than saying so.
 *
 * ---------------------------------------------------------------------------
 * WHY, AND IT IS NOT HYPOTHETICAL.
 *
 * #427 praises `docs/DELETION.md` for ending with a list of what it does NOT
 * cover, each with an issue number, and its fourth ask is to *"check the lists
 * periodically — an accurate list is the whole value, and a stale one is worse
 * than none because it asserts coverage that has lapsed."*
 *
 * That is exactly what happened, to that exact list, four days after #427 was
 * filed. Writing the public deletion page (#357) meant reading D48's open list
 * and publishing what it said was unhandled. Two of its four entries had
 * closed — account deletion had shipped, and the marketing form's messages had
 * got their own retention. **Both would have been published to customers as
 * things we do not do.** The list was not merely stale; it was actively
 * misleading on a page where being wrong reads as dishonesty.
 *
 * It cost a check that takes seconds. This is that check.
 *
 * ---------------------------------------------------------------------------
 * WHY IT FAILS THE BUILD RATHER THAN WARNING.
 *
 * The obvious objection is that this goes red the moment anyone closes an
 * issue, and a permanently-red job is one people learn to scroll past — the
 * failure mode `verify-backup-posture.mjs` reasons about at length.
 *
 * It is not the same shape. A closed issue in an open list is not a background
 * condition somebody has decided to live with; it is a document making a claim
 * that has become false, and the fix is one line in that document. Same as
 * `check-doc-citations.mjs` failing when a cited path moves: actionable, quick,
 * and the alternative is a document nobody can trust.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DOCS = "docs";

/**
 * The heading that opts a document in. Matching on the heading rather than on
 * "any issue number in any document" is deliberate: docs cite issues constantly
 * for provenance ("shipped in #263"), and a closed issue is the NORMAL state for
 * those. Only a list that claims something is still open makes a claim that can
 * rot.
 */
// The section number is optional: CALLS-V3 numbers its headings, D48 does not.
// The first version required a bare heading, silently saw one document instead
// of two, and reported a pass — the same matches-nothing failure the parity
// vectors guard against. Hence the floor below.
const HEADING = /^#{1,3}\s+(?:[\d.]+\s+)?Open, and tracked elsewhere\s*$/im;

function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

/** The section's body: from the heading to the next heading of any level. */
function openSection(source) {
  const match = HEADING.exec(source);
  if (!match) return null;
  const after = source.slice(match.index + match[0].length);
  const next = /^#{1,3}\s+/m.exec(after);
  return next ? after.slice(0, next.index) : after;
}

const found = [];
for (const file of markdownFiles(DOCS)) {
  const section = openSection(readFileSync(file, "utf8"));
  if (section === null) continue;
  // ONLY the issue a list item LEADS with, per the convention D48 set:
  //   - **#316** — a released number must carry no history to its next owner
  //
  // Not every number in the section. The prose around these lists cites issues
  // for provenance ("now a stated boundary (#357)"), and a closed issue is the
  // normal, correct state for those. Counting them would fire on documents that
  // are telling the truth, which is how a guard gets disabled. The first draft
  // did exactly that and reported #357 — the issue this guard was built for.
  for (const line of section.split(/\r?\n/)) {
    // Struck entries are resolved ON PURPOSE and kept for the reader:
    // "~~#340~~ — closed" is a document doing the right thing.
    if (line.includes("~~")) continue;
    const item = /^\s*[-*]\s*\**#(\d{2,5})\**/.exec(line);
    if (item) found.push({ file, issue: Number(item[1]) });
  }
}

// A guard that matches nothing passes forever. These two documents carry the
// convention today; if a rename or a heading edit hides one, this says so
// rather than reporting a clean run over an empty set.
const MUST_CARRY = ["DELETION.md", "CALLS-V3.md"];
const seen = new Set(found.map((entry) => entry.file));
const missing = MUST_CARRY.filter(
  (name) => ![...seen].some((file) => file.endsWith(name)),
);
if (missing.length > 0) {
  console.error(
    `\nNo open-list entries found in: ${missing.join(", ")}\n` +
      "Either the section was removed, or its heading no longer matches. A " +
      "check that silently stops looking is worse than one that fails.\n",
  );
  process.exit(1);
}

const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
if (!token) {
  console.log(
    `Skipped: GITHUB_TOKEN is not set. ${found.length} entry(ies) unverified ` +
      "— a guard that cannot reach GitHub knows nothing, and passing would say " +
      "otherwise.",
  );
  process.exit(0);
}

const repo = process.env.GITHUB_REPOSITORY ?? "BytechLabs/Texturion";
const stale = [];
const unknown = [];

for (const { file, issue } of found) {
  const response = await fetch(
    `https://api.github.com/repos/${repo}/issues/${issue}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "loonext-open-list-check",
      },
    },
  );
  if (!response.ok) {
    unknown.push(`${file}: #${issue} (HTTP ${response.status})`);
    continue;
  }
  const body = await response.json();
  if (body.state === "closed") {
    stale.push(`${file}: #${issue} is CLOSED — "${body.title}"`);
  }
}

for (const line of unknown) console.error(`  ? could not check ${line}`);

// If NOTHING could be checked, say so instead of reporting a clean run. The
// no-token path already refuses to claim a pass it did not earn; a token that
// cannot read issues (restricted workflow permissions, most likely) is the same
// state reached a different way, and the first version of this file let it
// through as success. A guard that knows nothing must not look like a guard
// that found nothing.
if (unknown.length === found.length) {
  console.error(
    `\nVerified NOTHING: all ${found.length} lookup(s) failed. The token cannot ` +
      "read issues — check the workflow's `permissions:` block for " +
      "`issues: read`.\n",
  );
  process.exit(1);
}

if (stale.length > 0) {
  console.error("\nA document lists these as open, and they are not:\n");
  for (const line of stale) console.error(`  x ${line}`);
  console.error(
    "\nStrike the entry (~~#123~~ — closed, plus what shipped) rather than " +
      "deleting it, so the next reader sees it resolved instead of wondering " +
      "whether it was ever tracked.\n" +
      "#427: an accurate list is the whole value, and a stale one asserts " +
      "coverage that has lapsed.\n",
  );
  process.exit(1);
}

console.log(
  `Open lists: ${found.length} tracked issue(s) across ` +
    `${new Set(found.map((entry) => entry.file)).size} document(s), all still open.`,
);
