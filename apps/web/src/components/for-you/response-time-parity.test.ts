/**
 * #239 — the response-time copy is identical on web, Android and iOS.
 *
 * The sentences live in three languages with nothing connecting them, and a
 * wording fix applied to one is invisible in the other two. The failure that
 * produces is the #273 one: a crew comparing the phone and the laptop reads two
 * different accounts of the same fortnight and cannot tell which is right.
 *
 * This is the second such guard (see `media-refused-parity.test.ts`). It exists
 * separately rather than folded in because these two sets of sentences change for
 * different reasons.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

const SOURCES: Record<string, string> = {
  web: join(REPO_ROOT, "apps/web/src/components/for-you/response-time-card.tsx"),
  android: join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/features/foryou/ResponseTimeCard.kt",
  ),
  ios: join(REPO_ROOT, "apps/ios/Loonext/Features/ForYou/ResponseTimeCard.swift"),
};

/**
 * The sentences, as the owner reads them.
 *
 * The arc phrases are fragments because each language interpolates the duration
 * differently; the rest are whole sentences.
 */
const FRAGMENTS: readonly string[] = [
  "when you started",
  "Down from ",
  "Up from ",
  "Your starting point lands once you have been here a fortnight",
  "No answered leads in your first two weeks, so there is nothing to compare",
  "About the same as when you started",
  "to answer a new customer",
  "Slowest 10% of answers",
  "Details",
  "Hide details",
  // #482: the per-number breakdown. The suffix rather than the whole label,
  // because the number itself is interpolated and the arithmetic in front of it
  // is written in three languages — what has to match is the WORD a reader sees
  // next to it, which is the part that could drift into "missed" on one client
  // and "unanswered" on another.
  " unanswered",
];

describe("#239 response-time copy is the same on every client", () => {
  it("reads all three sources, so a passing run means something", () => {
    for (const [platform, path] of Object.entries(SOURCES)) {
      const text = readFileSync(path, "utf8");
      expect(text.length, platform).toBeGreaterThan(1000);
      expect(text, platform).toContain("median_seconds");
    }
  });

  it("carries every fragment on every platform, verbatim", () => {
    const missing: string[] = [];
    for (const [platform, path] of Object.entries(SOURCES)) {
      const text = readFileSync(path, "utf8");
      for (const fragment of FRAGMENTS) {
        if (!text.includes(fragment)) missing.push(`${platform}: ${fragment}`);
      }
    }
    expect(
      missing,
      `These #239 sentences are missing or reworded on some platforms. Change ` +
        `all three together, and update FRAGMENTS here:\n  ` +
        missing.join("\n  "),
    ).toEqual([]);
  });

  it("names the unanswered leak in the singular on every platform", () => {
    // "1 leads nobody answered" is the kind of thing that makes a careful reader
    // stop trusting the rest of the panel.
    for (const [platform, path] of Object.entries(SOURCES)) {
      const text = readFileSync(path, "utf8");
      expect(text, platform).toContain("lead nobody answered");
      expect(text, platform).toContain("leads nobody answered");
    }
  });

  it("#508: the unanswered row goes somewhere on every platform", () => {
    // The gap this closes: web linked the row and both phones rendered the same
    // sentence inert, so the laptop offered a way to act on the leak and the
    // phone in the van did not.
    // The callback must be INVOKED as the row's action, not merely mentioned.
    // A bare /onOpenUnanswered/ was the first version of this and it could not
    // fail: the identifier also appears on the public parameter, on the forward
    // into the private body, and on that body's own parameter. Deleting the tap
    // handler — which is exactly the inert row #508 fixed — left three matches
    // behind and the guard green.
    const DESTINATION: Record<string, RegExp> = {
      web: /href="\/inbox\?awaiting=true"/,
      android: /clickable\(onClick = onOpenUnanswered\)/,
      ios: /Button\(action: onOpenUnanswered\)/,
    };
    for (const [platform, path] of Object.entries(SOURCES)) {
      const text = readFileSync(path, "utf8");
      expect(text, platform).toMatch(DESTINATION[platform]);
    }
  });

  it("#508/#503: that callback is required on the phones, never defaulted", () => {
    // An optional navigation callback is how BOTH clients came to ship this row
    // unwired: the compiler cannot tell "nobody passed it" from "deliberately
    // inert", so the dead affordance only surfaces on somebody's phone.
    // Bound to the PUBLIC declaration, and rejecting ANY default.
    //
    // The first version of this asserted `not.toMatch(/=\s*null/)` and matched
    // the declaration shape anywhere in the file. Both halves were wrong.
    // `= null` is not how you write an inert default in Kotlin — `= {}` is, and
    // it is precisely the "silently inert instead of a compile error" #503 is
    // about, so the negative half missed the realistic regression entirely. And
    // the positive half matched the PRIVATE helper's parameter, a declaration
    // no call site can see, so it never bound to the composable ForYouTab
    // actually calls.
    const publicParams = (text: string, marker: string): string => {
      const at = text.indexOf(marker);
      expect(at, `no ${marker} in the source`).toBeGreaterThan(-1);
      let depth = 0;
      let i = at + marker.length - 1;
      for (; i < text.length; i += 1) {
        if (text[i] === "(") depth += 1;
        else if (text[i] === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      return text.slice(at, i + 1);
    };

    const android = publicParams(
      readFileSync(SOURCES.android, "utf8"),
      "fun ResponseTimeCard(",
    );
    expect(android).toMatch(/onOpenUnanswered:\s*\(\)\s*->\s*Unit\s*,/);
    expect(
      android,
      "onOpenUnanswered has a default on the PUBLIC composable, so a caller " +
        "that forgets it compiles and ships an inert row",
    ).not.toMatch(/onOpenUnanswered:[^,]*=/);

    // Swift declares stored properties in the struct body rather than a
    // parameter list, so read to the first `var body` instead.
    const iosSource = readFileSync(SOURCES.ios, "utf8");
    const structAt = iosSource.indexOf("struct ResponseTimeCard: View {");
    expect(structAt).toBeGreaterThan(-1);
    const iosProps = iosSource.slice(
      structAt,
      iosSource.indexOf("var body", structAt),
    );
    expect(iosProps).toMatch(/let onOpenUnanswered:\s*\(\)\s*->\s*Void/);
    expect(
      iosProps,
      "onOpenUnanswered is defaulted or optional on ResponseTimeCard, which is " +
        "how an unwired navigation callback ships as a dead tap",
    ).not.toMatch(/onOpenUnanswered:[^\n]*(=|\?)/);
  });

  it("#508: every iOS construction site passes it, previews included", () => {
    // Swift only compiles in CI's Gate/iOS job, so a required parameter added
    // without updating a `#Preview` block is invisible here and turns main red
    // several minutes later. It did, on the first push of this change: three
    // previews build `ForYouList` and none of them passed the new callback.
    //
    // Each call is read to its balanced closing paren rather than counted —
    // a bare count also matches the declaration and the ResponseTimeCard call
    // below it, which is how a broken guard passes.
    const source = readFileSync(SOURCES.ios, "utf8");
    const forYouTab = readFileSync(
      join(REPO_ROOT, "apps/ios/Loonext/Features/ForYou/ForYouTab.swift"),
      "utf8",
    );

    /** The argument text of each `ForYouList(…)` call in the file. */
    const callsToForYouList = (text: string): string[] => {
      const calls: string[] = [];
      const marker = "ForYouList(";
      let from = text.indexOf(marker);
      while (from !== -1) {
        let depth = 0;
        let i = from + marker.length - 1;
        for (; i < text.length; i += 1) {
          if (text[i] === "(") depth += 1;
          else if (text[i] === ")") {
            depth -= 1;
            if (depth === 0) break;
          }
        }
        calls.push(text.slice(from, i + 1));
        from = text.indexOf(marker, i);
      }
      return calls;
    };

    const calls = callsToForYouList(forYouTab);
    // The real call site plus its previews — if this ever reads 0 the guard has
    // stopped guarding and the assertion below would pass vacuously.
    expect(calls.length).toBeGreaterThan(1);
    const missing = calls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => !call.includes("onOpenUnanswered:"))
      .map(({ index }) => `ForYouList call #${index + 1}`);
    expect(
      missing,
      `These construct ForYouList without the required onOpenUnanswered: ` +
        `${missing.join(", ")}. A #Preview that omits it fails only in CI's ` +
        `Gate/iOS job, several minutes after the push.`,
    ).toEqual([]);
    // And the card still declares it, so the check above is measuring a real
    // requirement rather than a parameter that quietly went away.
    expect(source).toMatch(/let onOpenUnanswered:/);
  });

  it("asks the shared arc helper on every platform, so the wrong direction is reportable", () => {
    // The check that keeps the good news credible. A client that decides the
    // direction itself is a client that can quietly stop reporting the bad one —
    // and both "Up from" and "Down from" come from this one answer.
    for (const [platform, path] of Object.entries(SOURCES)) {
      const text = readFileSync(path, "utf8");
      expect(text, platform).toMatch(/arcDirection|responseArcDirection/);
      expect(text, platform).toContain("Up from ");
    }
  });
});
