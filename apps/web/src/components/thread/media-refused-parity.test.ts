/**
 * #317 — the refused-attachment copy is identical on web, Android and iOS.
 *
 * WHY A TEST AND NOT A CODE REVIEW. This copy is hand-ported into three
 * languages, and hand-ported logic drifts silently: the sentences live in
 * `system-line.tsx`, `Timeline.kt` and `Timeline.swift`, nothing connects them,
 * and a wording fix applied to one is invisible in the other two. The failure it
 * produces is the one #273 already found once — a crew comparing the phone and
 * the laptop reads two different histories for the same conversation, and cannot
 * tell which is right.
 *
 * The check is deliberately narrow: the five refusal sentences, verbatim. It does
 * not compare the rest of the timeline, where per-platform interpolation syntax
 * differs legitimately (`${actor}` vs `$actor` vs `\(actor)`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

/** Where each client DECIDES which refusal a `media_refused` event is. */
const SOURCES: Record<string, string> = {
  web: join(
    REPO_ROOT,
    "apps/web/src/components/thread/system-line.tsx",
  ),
  android: join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/features/thread/Timeline.kt",
  ),
  ios: join(REPO_ROOT, "apps/ios/Loonext/Features/Thread/Timeline.swift"),
};

/**
 * And where each client keeps the WORDS.
 *
 * The same file on the phones, a different one on web since #228: web's English
 * moved out of the component and into the catalogue, and a guard still reading
 * `system-line.tsx` for sentences would have gone green on a component that no
 * longer contains a single one of them — the decorative-guard failure this
 * repo has now recorded more than once.
 *
 * The English in `sections/thread.ts` is therefore load-bearing for three
 * clients. It carries a comment saying so, next to the keys.
 */
const COPY: Record<string, string> = {
  ...SOURCES,
  web: join(REPO_ROOT, "apps/web/src/i18n/sections/thread.ts"),
};

/**
 * The sentences, as the crew reads them.
 *
 * Every one ends in what to DO about it, because that is the only part somebody
 * between jobs can act on. The reasons a customer can fix say so; `type_mismatch`
 * deliberately does not send them back to try the same file again.
 */
const SENTENCES: readonly string[] = [
  "A file this customer sent was too big to save — ask them to send a smaller one",
  "A file this customer sent arrived empty — ask them to send it again",
  "A file this customer sent wasn't the kind of file it claimed to be, so it wasn't saved",
  "This message came with more files than we can save",
  "A file this customer sent can't be shown here — ask them to send a photo or a PDF",
  // Added by 08fb5697 ("look inside the files we hand between strangers") to
  // all three clients, and never to this roster. For however long that has
  // been true, two of the seven refusal reasons had no parity cover at all:
  // one client could have reworded either of these and nothing would have
  // said so. That silence is the reason for the completeness check below.
  "A file this customer sent had something unsafe inside it, so it wasn't saved — ask them for a photo or a plain PDF",
  "A file this customer sent couldn't be checked, so it wasn't saved — ask them to send it again",
];

describe("#317 refused-attachment copy is the same on every client", () => {
  it("reads all three sources, so a passing run means something", () => {
    // A path that silently reads nothing would make every assertion below
    // vacuous — the failure mode of every filesystem-derived check.
    for (const [platform, path] of Object.entries(SOURCES)) {
      const text = readFileSync(path, "utf8");
      expect(text.length, platform).toBeGreaterThan(1000);
      expect(text, platform).toContain("media_refused");
    }
    // And the copy files, which on web is a different file. Anchored on a key
    // rather than a sentence, so this stays a "did we read the right file"
    // check and not a second copy of the verbatim one below.
    for (const [platform, path] of Object.entries(COPY)) {
      const text = readFileSync(path, "utf8");
      expect(text.length, platform).toBeGreaterThan(1000);
    }
    expect(readFileSync(COPY.web, "utf8")).toContain("sysMediaTooLarge");
  });

  it("the roster covers every refusal the clients can actually show", () => {
    // The check the roster did not have, and the reason it fell two behind.
    //
    // A hand-maintained list only ever proves that the sentences ON it match
    // across clients. It says nothing about a sentence that exists in the
    // product and is not on it — so 08fb5697 added `unsafe_content` and
    // `unreadable` arms to all three clients, this file stayed green, and two
    // of the seven refusal reasons quietly had no parity cover.
    //
    // Derived from Android's `mediaRefusedLine`, which is one `when` block with
    // its sentences inline: every literal long enough to be prose has to be on
    // the roster. Adding an arm now fails here until somebody adds the sentence,
    // which is the moment they ask whether the other two clients say it too.
    const kotlin = readFileSync(SOURCES.android, "utf8");
    const fn = kotlin.slice(
      kotlin.indexOf("fun mediaRefusedLine"),
      kotlin.indexOf("\n}", kotlin.indexOf("fun mediaRefusedLine")),
    );
    expect(fn.length, "could not find mediaRefusedLine").toBeGreaterThan(200);

    const uncovered = [...fn.matchAll(/"([A-Z][^"]{24,})"/g)]
      .map((m) => m[1])
      // Interpolated variants ("… the first $kept were kept") cannot be matched
      // whole, so they are covered by their stem being on the roster.
      .filter((line) => !SENTENCES.some((s) => line.startsWith(s.slice(0, 40))));

    expect(
      uncovered,
      `These refusal sentences exist in the product and are on no roster, so ` +
        `nothing checks the other clients say them:\n  ` + uncovered.join("\n  "),
    ).toEqual([]);
  });

  it("carries every sentence on every platform, verbatim", () => {
    const missing: string[] = [];
    for (const [platform, path] of Object.entries(COPY)) {
      const text = readFileSync(path, "utf8");
      for (const sentence of SENTENCES) {
        if (!text.includes(sentence)) missing.push(`${platform}: ${sentence}`);
      }
    }
    expect(
      missing,
      `These #317 refusal sentences are missing or reworded on some platforms. ` +
        `Change all three together, and update SENTENCES here:\n  ` +
        missing.join("\n  "),
    ).toEqual([]);
  });

  it("handles the item-cap count as a number on the platforms that read it", () => {
    // A JSON number read as a string is the #270 bug: it renders as "10" on one
    // platform and nothing on another. Android's payloadString returns the digits
    // of a JSON number, so it must convert; iOS has an intValue accessor and the
    // #270 comment says to use it.
    const android = readFileSync(SOURCES.android, "utf8");
    expect(android).toContain('payloadString("index")?.toIntOrNull()');
    const ios = readFileSync(SOURCES.ios, "utf8");
    expect(ios).toContain('event.payload["index"]?.intValue');
  });
});
