#!/usr/bin/env node
/**
 * [#334] Every capability claim on the marketing site, in one list.
 *
 *   node scripts/ops/claims-audit.mjs
 *   node scripts/ops/claims-audit.mjs --page compare
 *
 * ---------------------------------------------------------------------------
 * WHY A LIST AND NOT A CHECK
 *
 * #334 asks for "a periodic claims audit: walk every marketing page and check
 * each capability statement against what the product does". The checking part
 * cannot be automated — "calls ring your whole crew" is true or false depending
 * on code nobody can diff against a sentence. What CAN be automated is the
 * walking, which is the part that does not happen because it is tedious.
 *
 * So this collects the claim-shaped sentences and prints them by page. A person
 * reads the list against the product. That takes minutes instead of an hour,
 * which is the difference between a pass that happens and one that does not.
 *
 * The guard that DOES check something lives next to the copy it guards:
 * `honest-omissions.test.ts` fails when a negative claim cites a decision that
 * `DECISIONS.md`'s "Do not build" table no longer carries.
 *
 * ---------------------------------------------------------------------------
 * WHAT COUNTS AS A CLAIM
 *
 * Sentences that assert a capability, a refusal, or a price. Deliberately over-
 * inclusive: a false positive costs one line of reading, a miss costs a refund
 * request. #334's asymmetry, applied to its own audit.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { argv } from "node:process";
import { join, relative } from "node:path";

const ROOT = "apps/web/src/app/(marketing)";

/**
 * The shapes a capability claim takes in this copy. Refusals, inclusions,
 * prices, and the comparative statements that name a competitor.
 */
const PATTERNS = [
  /\bno (?:mass|full|review|dialer|blast)/i,
  /\b(?:doesn't|does not|don't|do not|isn't|is not|won't|will not) (?:do|have|chase|claim|include|offer|support|pretend)/i,
  /\bincluded on every plan\b/i,
  /\bevery plan\b/i,
  /\$\d+(?:\.\d+)?\s*(?:\/|a )?(?:mo|month|user|seat)/i,
  /\bunlimited\b/i,
  /\bnever\b.{0,40}\b(?:charge|bill|sell|share)\b/i,
];

/** Copy lives in string literals; this is what a sentence looks like in one. */
function claimsIn(source) {
  const found = [];
  // Split on sentence ends inside the file wholesale — crude, and the point is
  // to surface a line for a human rather than to parse TSX.
  for (const raw of source.split(/\n/)) {
    const line = raw.trim();
    if (line.startsWith("*") || line.startsWith("//")) continue; // comments
    if (!PATTERNS.some((p) => p.test(line))) continue;
    // Strip JSX and quoting noise so the claim itself is readable.
    const cleaned = line
      .replace(/^[a-zA-Z_]+:\s*/, "")
      .replace(/^["'`]|["'`],?$/g, "")
      .trim();
    if (cleaned.length > 12) found.push(cleaned);
  }
  return found;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry) && !entry.includes(".test.")) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const only = argv.includes("--page") ? argv[argv.indexOf("--page") + 1] : null;
  const files = walk(ROOT).filter((f) => (only ? f.includes(only) : true));

  let total = 0;
  const pages = [];
  for (const file of files) {
    const claims = claimsIn(readFileSync(file, "utf8"));
    if (claims.length === 0) continue;
    pages.push({ file: relative(".", file).replaceAll("\\", "/"), claims });
    total += claims.length;
  }

  console.log(
    `\n  ${total} capability claim(s) across ${pages.length} page(s), from ` +
      `${files.length} file(s) scanned.\n` +
      `  Read each against what the product does today. A claim that UNDERSTATES\n` +
      `  us loses a deal quietly; one that OVERSTATES us produces a refund request.\n`,
  );
  for (const { file, claims } of pages) {
    console.log(`  ── ${file}`);
    for (const claim of claims) {
      console.log(`     ${claim.length > 150 ? `${claim.slice(0, 147)}...` : claim}`);
    }
    console.log("");
  }
  console.log(
    "  Negative claims on /compare are additionally bound to the decision they\n" +
      "  rest on, and honest-omissions.test.ts fails if that decision's refusal\n" +
      "  leaves the \"Do not build\" table.\n",
  );
}

main();
