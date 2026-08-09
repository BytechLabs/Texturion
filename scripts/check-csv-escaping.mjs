#!/usr/bin/env node
/**
 * [#580] A CSV cell that a spreadsheet EXECUTES instead of displaying.
 *
 * WHY THIS EXISTS. `GET /v1/audit-log?format=csv` carried its own private
 * `csvCell` that applied RFC-4180 quoting and never called `csvSafeText`. It was
 * the ONLY export in the repository that did not, and the quoting was not even
 * neutral about it: wrapping the field preserved the commas between a formula's
 * arguments, so `=IMPORTDATA("https://…")` — set by any member on their own
 * display name — arrived at the insurer's spreadsheet whole and fired with no
 * prompt. The second payload needed no attacker at all: `messaging/opt-out.ts`
 * writes an E.164 number into `target_id`, so a `+`-leading cell was already in
 * every export any workspace with a STOP had ever produced.
 *
 * Four other exports got this right. Nothing compared them, so being the odd one
 * out cost nothing and was invisible in every diff — the route read as correct,
 * because a local function called `csvCell` looks exactly like the thing you were
 * supposed to call.
 *
 * WHAT IT REFUSES, and it is three questions rather than one, because the defect
 * had three shapes and fixing only the visible one leaves the others:
 *
 *   1. a file that EMITS CSV bytes must build them with the shared `serializeCsv`
 *      — that is the check the audit log failed;
 *   2. `serializeCsv` itself must still guard every cell. This replaced a
 *      per-file "does the producer mention `csvSafeText`" rule, which a review
 *      defeated in one line: it guarded the `actor` column, left the `+E.164`
 *      target bare, and the check passed. A file-level presence test cannot see
 *      WHICH columns were guarded, so the guard moved into the serializer and
 *      this rule now protects the one function all five exports depend on.
 *      Checking the callers while exempting the implementation is exactly how the
 *      avatar guard (#569) was defeated by gutting the shared component;
 *   3. no second RFC-4180 implementation anywhere, spotted by the quote-doubling
 *      that every hand-rolled one contains. A route that serializes half its
 *      output through the shared path and hand-rolls the other half would satisfy
 *      both rules above and still ship the bug.
 *
 * THE SUBJECT LIST IS DERIVED FROM THE FILESYSTEM, never typed here. A
 * hand-written list of exports is precisely how this one was missed — it would
 * have been written when there were four, and the fifth would have been added by
 * somebody who never opened this file. Worse, a stale list still prints a pass.
 * So the tree is walked and every file that mentions CSV at all is classified, and
 * the classification is PRINTED: a producer this guard decided was only a mention
 * shows up in the output rather than vanishing from it.
 *
 * It also fails when it finds ZERO producers. A guard whose pattern has stopped
 * matching reality reports success in exactly the same words as a clean codebase,
 * and this repository has already paid for that twice (`check-open-lists`
 * skipping without a token, `check-guards` scraping a workflow that could be
 * refactored out from under it).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Everything the Worker can serve. NOT just `apps/api/src/routes`: three of the
 * five producers live in `apps/api/src/workspace` (the async history, tasks and
 * usage exports, whose bytes reach a customer through a signed URL instead of a
 * response body). Scoping this to the routes directory would have printed a
 * confident pass over 60% of the subject.
 */
const ROOT = "apps/api/src";

/**
 * The shared escaper itself. It is the layer being enforced, so it is not one of
 * its own callers, and rule 3 would flag its `""` doubling — which is the one
 * copy of that code we want.
 */
const SHARED_CSV_MODULE = "apps/api/src/routes/core/csv.ts";

/**
 * A test may hand-roll a fixture or assert on raw quoting; that is its job. No
 * bytes it writes reach a customer.
 */
const SKIP_SUFFIXES = [".test.ts", ".e2e.ts"];

/** Mentions CSV at all — the candidate set, before any judgement. */
const MENTIONS_CSV = /text\/csv|format=csv|serializeCsv|\.csv["'`]/;

/**
 * EMITS CSV bytes, which is the narrower claim that carries the obligation.
 *
 * A bare `text/csv` counts. An earlier version of this required a parameterised
 * `text/csv;`, a `.csv` filename, or a `.csv` literal — and a review proved the
 * gap by writing a new export that set `"Content-Type": "text/csv"` with no
 * charset and no filename. It was classified "mentions only" and the guard
 * exited 0. The whole point of this file is to catch the NEXT export, so a
 * plausible way of writing one must not be the way past it.
 *
 * The two files that mention the type without producing cells are named instead,
 * which is the honest trade: a short list of exceptions with a reason each beats
 * a clever pattern that silently excuses anything shaped like them.
 */
const EMITS_CSV = [/text\/csv/, /filename="[^"]+\.csv"/, /\.csv["'`]/];

/**
 * Mentions the type but turns no value into a cell.
 *
 * `core/attachments.ts` is an inbound upload allow-list — it decides whether to
 * ACCEPT a CSV, and never writes one. `exports.ts` mints a signed URL with a
 * content disposition for bytes another producer already serialized, and that
 * producer is checked where it writes them.
 *
 * Both are re-derived on every run: if either stops matching, the entry below is
 * reported as stale rather than quietly keeping a file exempt that has since
 * grown a serializer.
 */
const NOT_A_PRODUCER = new Map([
  [
    "apps/api/src/routes/core/attachments.ts",
    "inbound upload allow-list — decides whether to accept a CSV, never writes one",
  ],
  [
    "apps/api/src/routes/exports.ts",
    "signed-URL disposition for bytes a producer already serialized",
  ],
]);

/** Imported from the shared module — a local `serializeCsv` proves nothing. */
const SHARED_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["'][^"']*core\/csv["']/g;

/**
 * A second RFC-4180 writer. Quote-doubling is the giveaway and is unambiguous:
 * `""` inside a CSV field means one literal quote and nothing else does.
 */
const HAND_ROLLED = [
  { pattern: /replace\(\/"\/g,\s*'""'\)/, what: "RFC-4180 quote doubling" },
  { pattern: /join\("\\r\\n"\)/, what: "CRLF row assembly" },
];

function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry).replaceAll("\\", "/");
    if (statSync(full).isDirectory()) {
      out.push(...sources(full));
    } else if (full.endsWith(".ts")) {
      if (SKIP_SUFFIXES.some((skip) => full.endsWith(skip))) continue;
      out.push(full);
    }
  }
  return out;
}

/** Names this file pulls out of `routes/core/csv`. */
function sharedImports(source) {
  const names = new Set();
  for (const match of source.matchAll(SHARED_IMPORT)) {
    for (const name of match[1].split(",")) {
      const trimmed = name.trim().split(/\s+as\s+/)[0].trim();
      if (trimmed) names.add(trimmed);
    }
  }
  return names;
}

const producers = [];
const mentionsOnly = [];
const problems = [];

for (const file of sources(ROOT)) {
  if (file === SHARED_CSV_MODULE) continue;
  const source = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  if (!MENTIONS_CSV.test(source)) continue;

  const imported = sharedImports(source);
  /**
   * #587 widened this from `serializeCsv` to the three doors into the shared
   * module. Producers now call `csvBytes` (a stored file) or `csvResponse` (a
   * download); both call `serializeCsv` internally and add the byte-order mark,
   * and rule 4 below is what stops anything reaching past them to the text one.
   *
   * Both halves still matter — imported AND called. A file that imports the name
   * and hand-rolls its rows anyway is the shape rule 3 exists for.
   */
  const serializes = ["csvResponse", "csvBytes", "serializeCsv"].some(
    (door) => imported.has(door) && new RegExp(`\\b${door}\\(`).test(source),
  );
  const emits = EMITS_CSV.some((pattern) => pattern.test(source));

  const excused = NOT_A_PRODUCER.get(file);
  if (excused) {
    mentionsOnly.push(`${file} — ${excused}`);
    continue;
  }
  if (!emits && !serializes) {
    mentionsOnly.push(file);
    continue;
  }
  producers.push(file);

  if (!serializes) {
    problems.push(
      `${file} emits CSV bytes without going through routes/core/csv — no ` +
        `call to csvResponse, csvBytes or serializeCsv. That is #580 exactly: ` +
        `the audit-log ` +
        `export had a private cell writer, so it also had a private idea of what ` +
        `needed escaping.`,
    );
  }
  for (const { pattern, what } of HAND_ROLLED) {
    if (pattern.test(source)) {
      problems.push(
        `${file} contains its own ${what} (${pattern}). One export serializing ` +
          `part of its output through the shared path and hand-rolling the rest ` +
          `passes both rules above and still ships the defect.`,
      );
    }
  }
}

/**
 * The shared serializer's own obligation, which every rule above now leans on.
 *
 * `serializeCsv` applies `csvSafeText` to every cell, so a producer no longer has
 * to remember a per-column call — and this file no longer asks it to, because a
 * per-file "does it mention csvSafeText" check could never see WHICH columns got
 * it. A review proved that: it guarded `actor` and left the `+E.164` target bare,
 * and the check passed. The usage export was genuinely in that state — two of its
 * three columns guarded and one not.
 *
 * Moving the guard into the serializer is what closed that, so the serializer is
 * now the single point of failure for all five exports. Checking the callers and
 * exempting the implementation is how the avatar guard (#569) was defeated by
 * gutting the one function every caller trusted; this is that lesson applied
 * before it happens.
 */
{
  const shared = readFileSync(SHARED_CSV_MODULE, "utf8").replace(/\r\n/g, "\n");
  const body = /export function serializeCsv\(([\s\S]*?)\n}/.exec(shared);
  if (body === null) {
    problems.push(
      `cannot find serializeCsv in ${SHARED_CSV_MODULE} — this guard has lost the ` +
        `one function all five exports now route their cells through, and every ` +
        `check above would pass vacuously.`,
    );
  } else if (!/csvSafeText\(/.test(body[1])) {
    problems.push(
      `serializeCsv no longer applies csvSafeText (#580). Every export depends on ` +
        `it doing so — that is why they stopped calling it per column — so an ` +
        `unguarded serializer is the injection back in all five at once, with ` +
        `nothing in the producers to notice.`,
    );
  } else if (!/csvField\(csvSafeText\(/.test(body[1])) {
    problems.push(
      `serializeCsv applies csvSafeText but not inside csvField (#580). Order ` +
        `matters: guard first, quote second, so the apostrophe ends up INSIDE ` +
        `whatever quoting the field needs. Quoting first would put it outside the ` +
        `quotes, where it is a stray character rather than a guard.`,
    );
  }
}

/**
 * [#587] Rule 4 — the byte-order mark, which is a fourth way to be the odd one out.
 *
 * `GET /v1/contacts/export` prefixed EF BB BF and the other four exports did not,
 * because the mark was a thing each producer had to remember rather than a
 * property of producing a CSV. Excel on Windows opens a BOM-less CSV in the system
 * ANSI codepage, so an actor named `Zoë Fournier` arrived mangled in the one file
 * an owner hands to an insurer.
 *
 * The rule is expressed as a COUNT rather than as a per-producer pattern, and that
 * is the point: `serializeCsv` returns text with no mark, `csvBytes` adds it, so
 * "every producer agrees" is exactly "nothing calls the text one directly". One
 * caller, and it is inside the shared module. A producer that reached past
 * `csvBytes` would show up here as a second caller, whatever it then did with the
 * string.
 *
 * Comments are stripped before counting. This guard's own prose names
 * `serializeCsv` repeatedly, and so does the audit log's — a rule that counted
 * mentions rather than calls would fire on documentation.
 */
{
  const callers = [];
  for (const file of sources(ROOT)) {
    if (file === SHARED_CSV_MODULE) continue;
    const code = readFileSync(file, "utf8")
      .replace(/\r\n/g, "\n")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    if (/\bserializeCsv\s*\(/.test(code)) callers.push(file);
  }
  if (callers.length > 0) {
    problems.push(
      `${callers.join(", ")} call(s) serializeCsv directly (#587). That returns ` +
        `TEXT WITH NO BYTE-ORDER MARK, so whatever it produces opens in Excel's ` +
        `ANSI codepage and any non-ASCII name arrives as mojibake. Use csvBytes ` +
        `for a stored file or csvResponse for a download — both are in ` +
        `routes/core/csv.ts and both add the mark, which is the whole reason they ` +
        `exist. The four exports that lacked it lacked it because each one had to ` +
        `remember.`,
    );
  }

  const shared = readFileSync(SHARED_CSV_MODULE, "utf8").replace(/\r\n/g, "\n");
  if (!/0xef,\s*0xbb,\s*0xbf/i.test(shared)) {
    problems.push(
      `${SHARED_CSV_MODULE} no longer writes the UTF-8 byte-order mark (#587). ` +
        `Every producer now depends on it doing so — that is why none of them ` +
        `carries the bytes any more — so losing it here loses the mark from all ` +
        `five at once, with nothing in the producers to notice.`,
    );
  }
  if (!/export function csvResponse/.test(shared)) {
    problems.push(
      `csvResponse is gone from ${SHARED_CSV_MODULE} (#587), so the download ` +
        `headers and the mark have stopped travelling together and each route is ` +
        `back to remembering four things.`,
    );
  }
}

// A named exception that no longer matches anything is a file kept exempt by
// habit. Reported rather than ignored, because the reason it was exempt is
// exactly the thing that can stop being true.
for (const [file, why] of NOT_A_PRODUCER) {
  if (!mentionsOnly.some((entry) => entry.startsWith(file))) {
    problems.push(
      `${file} is listed as "not a producer" (${why}) but no longer matches — ` +
        `either it moved, or it stopped mentioning CSV, or it has since grown a ` +
        `serializer and is being excused by a stale entry. Re-check it and remove ` +
        `the entry.`,
    );
  }
}

// LOUD, not silent. A guard that has lost its subject prints the same success as
// one with nothing to find, and this is the only difference a reader gets.
if (producers.length === 0) {
  console.error(
    `check-csv-escaping: found NO CSV producers under ${ROOT}/.\n\n` +
      `There are supposed to be five (the contacts export, the audit-log export, ` +
      `and the history/tasks/usage workspace exports). Zero means the detection ` +
      `stopped matching reality — a moved directory, a renamed helper, a content ` +
      `type built by concatenation — and NOT that the codebase is clean. Fix the ` +
      `patterns (MENTIONS_CSV / EMITS_CSV) rather than reading this as a pass.`,
  );
  process.exit(1);
}

if (problems.length > 0) {
  console.error(
    `CSV exports must escape through routes/core/csv (#580):\n`,
  );
  for (const problem of problems) console.error(`  - ${problem}\n`);
  console.error(
    "A cell beginning `=`, `+`, `-` or `@` is a FORMULA to Excel, Sheets and\n" +
      "LibreOffice, evaluated on open. `=IMPORTDATA(\"https://…\")` needs no macro\n" +
      "prompt and can post the cells around it to a stranger; and every E.164\n" +
      "phone number we store already begins with `+`.\n\n" +
      "The shape, every time — cells guarded, rows serialized, two layers:\n" +
      "  import { csvSafeText, serializeCsv } from \"./core/csv\";\n" +
      "  serializeCsv([header, ...rows.map((r) => [r.a, r.b].map(csvSafeText))])\n\n" +
      "Guard every column, not the ones that look like free text today: the\n" +
      "audit log's `actor_ip` comes from an unvalidated X-Forwarded-For, and\n" +
      "csvSafeText is a no-op on any value that does not lead with a trigger, so\n" +
      "wrapping a timestamp column costs nothing and settles it permanently.",
  );
  process.exit(1);
}

console.log(
  `check-csv-escaping: ${producers.length} CSV producer(s) escape through routes/core/csv.`,
);
for (const file of producers) console.log(`  producer      ${file}`);
// Printed so a misclassification is visible. Each of these mentions CSV without
// turning values into cells; if a real export ever lands in this list, the list
// is where somebody notices.
for (const file of mentionsOnly) console.log(`  mentions only ${file}`);
