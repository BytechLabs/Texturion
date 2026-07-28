#!/usr/bin/env node
/**
 * Guard the env inventory the way `check-migrations.mjs` guards migrations.
 *
 * #377: `docs/deploy/` had forked into two env documents that each claimed
 * authority and each omitted variables production needs. Following one shipped
 * a Worker with no voice-overage metering — every minute past the allowance
 * billed to nobody. Following the other shipped one where `OPS_ALERT_EMAIL` was
 * never set, so every alert-before-the-cap in the product landed in the default
 * support inbox instead of wherever the founder actually reads.
 *
 * There is ONE deployed environment (docs/ENVIRONMENTS.md), so neither mistake
 * surfaces in a staging run. It surfaces in production, or on an invoice.
 *
 * A hand-maintained list of forty-odd variables had already drifted twice, so
 * the fix is not a better list — it is that the list stops being the authority.
 * The zod schemas decide what actually gets read; this makes the document
 * answer to them.
 *
 * WHAT IS CHECKED: every key in each surface's schema appears as a row in that
 * surface's section of the reference, and every row there is a real key.
 * Cloudflare BINDINGS are excluded — they come from `wrangler.jsonc`, no
 * operator sets them, and listing them would be noise.
 *
 * Usage: node scripts/check-env-doc.mjs
 */
import { readFileSync } from "node:fs";

const DOC = "docs/deploy/06-env-reference.md";

/**
 * Each surface's schema and the document section that must match it. BOTH are
 * checked, because the two ways to misconfigure this product sit on opposite
 * sides of it: the Worker bills nothing for voice, or the web app ships with
 * its error reporting and analytics silently off.
 */
const SURFACES = [
  {
    label: "API Worker",
    file: "apps/api/src/env.ts",
    schema: "const envSchema = z.object({",
    section: /^## A\. /m,
  },
  {
    label: "Web build",
    file: "apps/web/src/env.ts",
    schema: "const publicEnvSchema = z.object({",
    section: /^## B\. /m,
  },
];

/**
 * Zod types that are Cloudflare BINDINGS rather than operator-set config.
 * These come from `wrangler.jsonc`, and no amount of dashboard clicking sets
 * them, so an operator's variable reference should not list them.
 */
const BINDING_SCHEMAS = /(rateLimiterSchema|callSessionsSchema|workersAiSchema)/;

/** Read at runtime, but never set by hand by the person doing a deploy. */
const NOT_OPERATOR_SET = new Set([
  // Stamped by the deploy pipeline (wrangler --var GIT_SHA:...), not a secret.
  "GIT_SHA",
  // Set only in .dev.vars for local work; production must never carry it.
  "LOCAL_DEV",
]);

function schemaKeys(source, surface) {
  const start = source.indexOf(surface.schema);
  if (start === -1) throw new Error(`${surface.file}: schema not found`);
  const keys = new Set();
  for (const raw of source.slice(start).split("\n")) {
    // A CRLF checkout leaves \r on every line, and \r is a line TERMINATOR in
    // a JS regex — `.` does not match it, so `(.*)$` fails on every row and
    // the schema reads as EMPTY. That is not hypothetical: it happened while
    // writing this, and the failure mode was the guard confidently reporting
    // the entire document stale rather than reporting nothing at all.
    const line = raw.replace(/\r$/, "");
    // Top-level keys only: exactly two spaces of indent inside the object.
    const match = /^ {2}([A-Z][A-Z0-9_]*):\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, name, rest] = match;
    if (BINDING_SCHEMAS.test(rest)) continue;
    if (NOT_OPERATOR_SET.has(name)) continue;
    keys.add(name);
  }
  return keys;
}

/**
 * Only the surface's OWN section counts. The document legitimately also covers
 * GitHub Actions secrets and dashboard-only settings, which no schema knows
 * about — checking the whole file would flag every one of them as stale, and a
 * guard that cries wolf gets ignored within a week.
 */
function documentedKeys(markdown, surface) {
  const start = markdown.search(surface.section);
  if (start === -1) {
    throw new Error(`${DOC}: no section for ${surface.label}`);
  }
  const rest = markdown.slice(start + 1);
  const next = rest.search(/^#{2,3} /m);
  const section = next === -1 ? rest : rest.slice(0, next);

  const keys = new Set();
  // Rows lead with the variable in backticks, sometimes with a note before
  // the next cell: | `FOO_BAR` — **OPTIONAL** | ... |
  for (const match of section.matchAll(/^\|[ 	]*`([A-Z][A-Z0-9_]*)`[^|]*\|/gm)) {
    keys.add(match[1]);
  }
  return keys;
}

const markdown = readFileSync(DOC, "utf8");
let failed = false;

for (const surface of SURFACES) {
  const inCode = schemaKeys(readFileSync(surface.file, "utf8"), surface);
  const inDoc = documentedKeys(markdown, surface);
  const missing = [...inCode].filter((k) => !inDoc.has(k)).sort();
  const stale = [...inDoc].filter((k) => !inCode.has(k)).sort();

  if (missing.length === 0 && stale.length === 0) {
    console.log(
      `${surface.label}: ${inCode.size} variables, and ${DOC} agrees with ${surface.file}.`,
    );
    continue;
  }

  failed = true;
  console.error(`\n${DOC} and ${surface.file} disagree (${surface.label}).\n`);

  if (missing.length > 0) {
    console.error(
      "  READ AT RUNTIME, ABSENT FROM THE DOC. An operator following the\n" +
        "  document would stand up production without these:\n",
    );
    for (const key of missing) console.error(`    - ${key}`);
    console.error("");
  }

  if (stale.length > 0) {
    console.error(
      "  IN THE DOC, NOT IN THE SCHEMA. Renamed, retired, or a typo — and a\n" +
        "  variable nothing reads is a step an operator performs for nothing:\n",
    );
    for (const key of stale) console.error(`    - ${key}`);
    console.error("");
  }

  console.error(
    `  Fix the ${surface.label} section of ${DOC}, or ${surface.file} if the\n` +
      "  variable genuinely went away. There is ONE deployed environment, so a\n" +
      "  wrong inventory is found in production or on an invoice, never in a\n" +
      "  staging run.\n",
  );
}

process.exit(failed ? 1 : 0);
