/**
 * #407 — no surface may offer to reinstate consent the business does not own.
 *
 * The rule itself is settled and correct: a STOP the customer sent is a
 * CARRIER block, clearing our row would not clear Telnyx's, and the server
 * refuses the revoke and always will. Each client already carries the
 * predicate — `isCarrierEnforcedOptOut` exists in `lib/api/types.ts`,
 * `core/model/Contacts.kt` and `Core/Model/Contacts.swift`.
 *
 * What kept going wrong was the *use*. Five surfaces offer to undo an opt-out;
 * four of them learned to ask the predicate one at a time, over three separate
 * issues, and the fifth (the web contact panel) sat wrong for months while the
 * page beside it was right. That is #376 and #392's whole complaint: a rule
 * implemented per-client is a rule that differs per-client.
 *
 * ---------------------------------------------------------------------------
 * WHY A SOURCE TEST RATHER THAN A RENDER TEST.
 *
 * A render test per surface would pin the four we know about and say nothing
 * about the fifth somebody adds next quarter — which is precisely the failure
 * that has happened three times already. This asks the question that actually
 * matters: does every file that offers a revoke also ask which kind of opt-out
 * it is? A new surface on any client fails this the day it is written,
 * including the two clients that have no UI test runner at all.
 *
 * The cost is honest: this greps source. It cannot tell a correctly gated
 * button from a mention of the predicate in a comment. It is a floor, not a
 * proof — but it is a floor that spans three languages, and there was none.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** packages/shared/src → repo root. */
const REPO = join(__dirname, "..", "..", "..");

const CLIENT_ROOTS = [
  join(REPO, "apps", "web", "src"),
  join(REPO, "apps", "android", "app", "src", "main", "kotlin"),
  join(REPO, "apps", "ios", "Loonext"),
];

const SOURCE = /\.(tsx?|kt|swift)$/;

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "build" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(walk(full));
    else if (SOURCE.test(entry) && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

/**
 * Comments stripped, because a label named in prose is not an offer.
 *
 * `lib/api/contacts.ts` documents the transport hook as "Mark opted in again"
 * and correctly has no idea which kind of opt-out it is carrying — that is
 * what a transport is for. Matching it would have forced a gate into the layer
 * furthest from the person, which is the opposite of the fix.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

/**
 * JSX and Kotlin string concatenation both wrap a sentence across lines, so
 * the copy assertions read the text as a person sees it rather than as the
 * file stores it. Without this, a sentence broken after "by texting" fails a
 * check that the rendered UI passes.
 */
function flat(source: string): string {
  return source.replace(/\s+/g, " ");
}

/**
 * A file that OFFERS the revoke, as opposed to one that merely performs it.
 *
 * The repository layer and the controller/mutation layer legitimately call
 * `revokeOptOut` with no idea what kind of opt-out it is — that is the point of
 * a transport. The question is only asked of the files that put a control in
 * front of a person, which is what the label text identifies.
 *
 * #228 BROKE THE ORIGINAL SPELLING OF THIS, and the break is worth recording
 * because the guard caught itself. Web moved its labels into the i18n
 * catalogue, so the three web surfaces stopped containing the English sentence
 * and the discovery silently fell from seven files to four — with web missing
 * entirely. The "a passing test that greps nothing is a lie" assertion below is
 * the only reason that surfaced rather than becoming three unprotected screens.
 *
 * So the pattern now matches the KEY as well as the sentence. A surface is
 * identified by the label it renders, however it reaches it.
 */
/**
 * #407 — THE MOBILE THREAD SHEETS WERE NEVER FOUND.
 *
 * Every alternative here was a web spelling. Both phones spell the control
 * `revokeOptOut` and label it from the key `thread.removeOptOut`, so neither
 * matched — while the header of this file names "Android thread sheet, iOS
 * thread sheet" among the surfaces it covers. Two mobile CONTACT DETAIL
 * screens were discovered instead, the count assertion below said `>= 5`, and
 * the "spans all three clients" test was satisfied by those. Both phones read
 * as protected on the one control that can lift a carrier STOP.
 *
 * `removeOptOut` is the LABEL KEY, which is this file's own rule for what makes
 * something a surface — the thing a person reads. Deliberately not
 * `revokeOptOut`: that identifier also appears in the data and controller
 * layers, which put no control in front of anybody and would then be asserted
 * against a predicate they have no business calling.
 */
const OFFERS_REVOKE =
  /Mark opted in again|Remove opt-out|contactMarkOptedIn|markOptedInAgain|\bmarkOptedIn\b|removeOptOut/;

/**
 * #228: the CATALOGUE is not a surface.
 *
 * `apps/web/src/i18n/sections/*.ts` holds the words every screen says, so it
 * now contains "Mark opted in again" — and it will never call
 * `isCarrierEnforcedOptOut`, because it puts no control in front of anybody.
 * The surfaces that offer the revoke still read the answer; they just read the
 * label from here now.
 *
 * Excluded by PATH rather than by content: a content rule would have to guess
 * what a catalogue looks like, and the whole point of this file is that the
 * question gets asked wherever a person can press something.
 */
const IS_CATALOGUE = (file: string) =>
  // Case-INSENSITIVELY, because the three clients disagree about the folder's
  // capitalisation and only iOS spells it `Core/I18n/`. Written lowercase, this
  // matched web and Android and silently missed iOS the day iOS moved, so every
  // iOS catalogue section was read as a surface that offers a revoke without
  // asking which kind it is — three failures naming files nobody can press.
  file.replaceAll("\\", "/").toLowerCase().includes("/i18n/");

describe("#407 — every surface offering a revoke asks which kind it is", () => {
  const offering = CLIENT_ROOTS.flatMap(walk).filter(
    (file) =>
      !IS_CATALOGUE(file) &&
      OFFERS_REVOKE.test(code(readFileSync(file, "utf8"))),
  );

  /**
   * The surfaces that must be found BY NAME, not by count.
   *
   * A `>= 5` stood here and it is how the two thread sheets went missing: the
   * two mobile contact-detail screens took their places, the number was still
   * satisfied, and the "spans all three clients" test below was satisfied too.
   * A count cannot tell a surface dropping out from a different one arriving.
   *
   * Named by path suffix so a move inside a client is a rename here rather than
   * a silent loss. Extra discoveries are welcome and are still asserted — the
   * `it.each` runs over everything found, not over this list.
   */
  const MUST_OFFER = [
    "components/contact-panel/contact-panel.tsx",
    "components/thread/thread-header.tsx",
    "features/thread/ThreadScreen.kt",
    "Features/Thread/ThreadView.swift",
    "features/contacts/ContactDetailScreen.kt",
    "Features/Contacts/ContactDetailView.swift",
  ];

  it.each(MUST_OFFER)("finds %s", (suffix) => {
    // A passing test that greps nothing is a lie — and so is one that greps
    // the wrong five things.
    const found = offering.some((file) =>
      file.replaceAll("\\", "/").endsWith(suffix),
    );
    expect(
      found,
      `${suffix} offers a revoke and was not discovered, so nothing below ` +
        `asserts it asks which kind of opt-out it is. That is how the two ` +
        `thread sheets — the only control that can lift a carrier STOP — sat ` +
        `unguarded behind a count that said five.`,
    ).toBe(true);
  });

  it("finds at least the named surfaces", () => {
    expect(offering.length).toBeGreaterThanOrEqual(MUST_OFFER.length);
  });

  it("spans all three clients, so no client is silently unprotected", () => {
    for (const root of CLIENT_ROOTS) {
      expect(offering.some((file) => file.startsWith(root))).toBe(true);
    }
  });

  it.each(offering.map((file) => [file.slice(REPO.length + 1)] as const))(
    "%s asks isCarrierEnforcedOptOut before offering it",
    (relative) => {
      const source = code(readFileSync(join(REPO, relative), "utf8"));
      // A CALL, not a mention. `toContain` stood here and was satisfied by
      // `import com.loonext.android.core.model.isCarrierEnforcedOptOut` on line
      // 125 of the Android thread sheet — so deleting every call site left this
      // green. Found by trying to prove the fix above and watching nothing
      // fail, which is the only way this kind of thing ever surfaces.
      expect(
        source,
        `${relative} names isCarrierEnforcedOptOut but never calls it. An ` +
          `import is not a gate.`,
      ).toMatch(/isCarrierEnforcedOptOut\s*\(/);
    },
  );

  /**
   * #228: what a WEB surface says now lives in the catalogue, so read it there.
   *
   * Deliberately NOT "search the whole catalogue" — that would pass every web
   * file the moment any entry anywhere mentioned START, which is a check that
   * cannot fail. Instead the keys THIS FILE uses are resolved to their English
   * values, and only those are searched. A surface that stops naming START
   * still fails, because its own key no longer carries the word.
   */
  function catalogueFor(file: string): string | null {
    const path = file.replaceAll("\\", "/");
    const dir = path.includes("/apps/web/")
      ? join(REPO, "apps", "web", "src", "i18n", "sections")
      : path.includes("/apps/android/")
        ? join(
            REPO,
            "apps/android/app/src/main/kotlin/com/loonext/android/core/i18n",
          )
        : path.includes("/apps/ios/")
          ? join(REPO, "apps/ios/Loonext/Core/I18n")
          : null;
    if (dir === null) return null;
    let catalogue = "";
    for (const entry of readdirSync(dir)) {
      catalogue += readFileSync(join(dir, entry), "utf8");
    }
    return catalogue;
  }

  /**
   * The sentence a surface RENDERS, wherever it now lives.
   *
   * #228 moved the copy on web and Android into catalogues, so a source grep
   * for "text START" stopped finding it — and this guard's job is to check what
   * a person reads, not where the bytes sit. Only the keys THIS FILE uses are
   * resolved: searching the whole catalogue would pass every surface the moment
   * any entry anywhere mentioned START, which is a check that cannot fail.
   */
  function resolvedCopy(file: string, source: string): string {
    const catalogue = catalogueFor(file);
    if (catalogue === null) return source;
    let resolved = source;
    for (const use of source.matchAll(/"[\w]+\.(\w+)"/g)) {
      // A fixed window rather than a lazy match to the next comma: a catalogue
      // value is often concatenated across lines, and the first comma-newline
      // inside one would cut the sentence in half.
      /*
       * Two catalogue shapes, because the two clients store a key differently:
       * TypeScript writes `someKey: "…"`, Kotlin writes `"section.someKey" to
       * "…"`. Both are tried rather than branching on the client, so a third
       * client added later works without editing this.
       */
      const at = [
        catalogue.indexOf(`.${use[1]}"`),
        catalogue.indexOf(`${use[1]}:`),
      ].find((index) => index !== -1);
      if (at !== undefined) resolved += ` ${catalogue.slice(at, at + 400)}`;
    }
    return resolved;
  }

  it("names START as the customer's route back wherever it refuses", () => {
    // Ask 2: the owner will speak to this customer on the phone. "You can't do
    // that" is a dead end; "tell them to text START to your number" is a thing
    // they can say. Every refusing surface must carry it.
    for (const file of offering) {
      const source = readFileSync(file, "utf8");
      if (!code(source).includes("isCarrierEnforcedOptOut")) continue;
      expect(
        flat(resolvedCopy(file, source)),
        `${file.slice(REPO.length + 1)} refuses without naming START`,
      )
        .toMatch(/texting START|text START/);
    }
  });
});
