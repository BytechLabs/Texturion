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
  });

  it("carries every sentence on every platform, verbatim", () => {
    const missing: string[] = [];
    for (const [platform, path] of Object.entries(SOURCES)) {
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
