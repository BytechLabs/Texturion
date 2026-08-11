/**
 * #508 — "unanswered" means one thing on all three clients.
 *
 * The card counts leads with no response; the inbox filter has to open exactly
 * that set. The way three clients are kept from disagreeing is that none of
 * them decides: `awaiting_reply_since` (the #388 lead clock) is a column the
 * server filters on, and every client does the same one thing with it — sends
 * `awaiting=only`. A client that grew its own "needs a reply" rule would be
 * back to the `?status=new` failure this issue exists to fix, where the web and
 * the phone showed different threads under the same sentence.
 *
 * A source-text guard rather than a behavioural one, for the same reason
 * `response-time-parity.test.ts` is: Kotlin and Swift are not runnable from
 * this suite, and the drift being guarded against is somebody editing one of
 * the three and not the other two.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { inboxEn } from "@/i18n/sections/inbox";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

/** Where each client turns its own filter state into the request parameter. */
const REQUESTS: Record<string, string> = {
  web: join(REPO_ROOT, "apps/web/src/lib/api/conversations.ts"),
  android: join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/features/thread/MessagingData.kt",
  ),
  ios: join(REPO_ROOT, "apps/ios/Loonext/Core/Api.swift"),
};

/** Where each client offers the filter as a control somebody can pick. */
const CONTROLS: Record<string, string> = {
  web: join(REPO_ROOT, "apps/web/src/components/inbox/filter-bar.tsx"),
  android: join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/features/inbox/InboxTab.kt",
  ),
  ios: join(REPO_ROOT, "apps/ios/Loonext/Features/Inbox/InboxTab.swift"),
};

/**
 * #228: web's WORDS moved out of the control and the empty state into the
 * catalogue, so the two copy checks below read them from there. The two
 * BEHAVIOUR checks (`value="awaiting"`, the request parameter) still read the
 * component — those are claims about code, and moving them to the catalogue
 * would be how a control quietly stops sending the filter while the word for it
 * stays put.
 */
const WEB_COPY = Object.values(inboxEn).join("\n");

/**
 * #228 did the same to ANDROID: `InboxTab.kt` now calls `t("inbox.…")` and its
 * sentences live in a Kotlin catalogue of `"key" to "value"` pairs. The two copy
 * checks below therefore read that file for android; the behaviour checks keep
 * reading the component, for the reason above.
 */
const ANDROID_CATALOGUE = join(
  REPO_ROOT,
  "apps/android/app/src/main/kotlin/com/loonext/android/core/i18n/InboxStrings.kt",
);

/**
 * The Kotlin catalogue's VALUES.
 *
 * Keys stripped, and comment lines with them, for exactly the reason recorded
 * below for web: `inbox.viewNameUnanswered` contains the word "Unanswered", so a
 * catalogue read whole would let an IDENTIFIER satisfy a copy check while every
 * sentence beside it had been reworded.
 */
const ANDROID_COPY = readFileSync(ANDROID_CATALOGUE, "utf8")
  .replace(/"inbox\.[A-Za-z0-9_]+"\s*to\s*/g, "")
  .split("\n")
  .filter((line) => {
    const trimmed = line.trim();
    return !trimmed.startsWith("//") && !trimmed.startsWith("*");
  })
  .join("\n");

/** Every .swift file under apps/ios — the APP and the TEST target. */
function swiftSources(): string[] {
  const root = join(REPO_ROOT, "apps/ios");
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".swift"))
    .map((entry) => join(root, entry));
}

/** The argument text of each `Name(…)` call in `text`, paren-balanced. */
function callsTo(name: string, text: string): string[] {
  const marker = `${name}(`;
  const calls: string[] = [];
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
}

describe("#508 the unanswered filter is one predicate, three clients", () => {
  it("reads every source, so a passing run means something", () => {
    for (const path of [
      ...Object.values(REQUESTS),
      ...Object.values(CONTROLS),
    ]) {
      expect(readFileSync(path, "utf8").length).toBeGreaterThan(1000);
    }
    // Web's words are a fourth source. An emptied catalogue would make both
    // copy checks below pass against nothing.
    expect(WEB_COPY.length).toBeGreaterThan(1000);
    // Android's are a fifth, for the same reason.
    expect(ANDROID_COPY.length).toBeGreaterThan(1000);
  });

  it("sends the same `awaiting` parameter from every client", () => {
    for (const [platform, path] of Object.entries(REQUESTS)) {
      const text = readFileSync(path, "utf8");
      expect(text, platform).toMatch(/["']?awaiting["']?\s*[:=]/);
    }
  });

  it("asks for 'only' — the narrower question, never a second rule", () => {
    // The literal each client sends. `only` is the whole vocabulary: unset
    // means no filter, because the ordinary inbox shows answered and
    // unanswered alike. The phones read their own controller state into the
    // request; web's control is the URL, so its translation lives beside the
    // other filters rather than in the component.
    const android = readFileSync(CONTROLS.android, "utf8");
    expect(android).toMatch(/awaiting = if \(awaitingOnly\) "only" else null/);
    const ios = readFileSync(CONTROLS.ios, "utf8");
    expect(ios).toMatch(/awaiting: awaitingOnly \? "only" : nil/);
    const filterUrl = readFileSync(
      join(REPO_ROOT, "apps/web/src/components/inbox/filter-url.ts"),
      "utf8",
    );
    expect(filterUrl).toContain('out.awaiting = "only"');
  });

  it("calls it the same thing on every client", () => {
    // "Unanswered", not "Needs reply" on one and "No reply" on another. The
    // word travels between a crew's phone and the office laptop out loud.
    // Web is the catalogue's values ALONE. Including filter-bar.tsx as well was
    // the first version and it could not fail: the item calls
    // `t("inbox.chipUnanswered")`, and the key contains the word, so renaming
    // the label to "No reply yet" still matched. An identifier is not copy.
    // Android reads the same way now, off its own catalogue's values.
    const COPY: Record<string, string> = {
      web: WEB_COPY,
      android: ANDROID_COPY,
      ios: readFileSync(CONTROLS.ios, "utf8"),
    };
    for (const [platform, text] of Object.entries(COPY)) {
      expect(text, platform).toContain("Unanswered");
    }
  });

  it("is reachable as a filter in its own right, not only by arriving", () => {
    // A destination you can reach from exactly one card is one most of the crew
    // never learns exists. Each client offers it where its other filters live:
    // web's `+ Filter` popover, Android's filter sheet, iOS's chip row.
    const web = readFileSync(CONTROLS.web, "utf8");
    expect(web).toMatch(/value="awaiting"/);
    const android = readFileSync(CONTROLS.android, "utf8");
    expect(android).toMatch(/toggleAwaiting\(\)/);
    const ios = readFileSync(CONTROLS.ios, "utf8");
    expect(ios).toMatch(/toggleAwaiting\(\)/);
  });

  it("says the same thing when the list is empty", () => {
    // "Nothing matches these filters" reports the best news this screen can
    // give as an absence. Three clients saying it three ways is the #273
    // failure in miniature.
    // #228: web's copy of the sentence lives in the catalogue now; the
    // component that renders it is `components/inbox/empty-states.tsx`.
    const EMPTY_STATES: Record<string, string> = {
      web: WEB_COPY,
      android: ANDROID_COPY,
      ios: readFileSync(CONTROLS.ios, "utf8"),
    };
    for (const [platform, text] of Object.entries(EMPTY_STATES)) {
      expect(text, platform).toContain("Everyone has been answered.");
    }
  });

  it("every iOS ViewSelection carries the new field, TEST TARGET INCLUDED", () => {
    // The break this exists to catch, twice over. `awaitingOnly` was added to
    // ViewSelection, the app target was swept, and `apps/ios/LoonextTests` was
    // not — so Gate/iOS went red on the commit that was FIXING the previous
    // red. Swift only compiles on a mac here, so the whole cost of forgetting a
    // directory is paid in CI round trips.
    //
    // Scanning every .swift under apps/ios, rather than a list of files, is the
    // point: a directory that is not in the list is exactly what went wrong.
    const missing: string[] = [];
    let seen = 0;
    for (const path of swiftSources()) {
      const text = readFileSync(path, "utf8");
      for (const call of callsTo("ViewSelection", text)) {
        seen += 1;
        if (!call.includes("awaitingOnly")) {
          missing.push(path.slice(path.indexOf("apps")));
        }
      }
    }
    expect(seen).toBeGreaterThan(2); // app + tests, or the sweep found nothing
    expect(
      missing,
      `These construct ViewSelection without awaitingOnly: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("survives as a destination, so the card's row can land on it", () => {
    // The router flag, not a chip tap: the tab switch happens between the tap
    // and the inbox reading it, so the request has to outlive it.
    const web = readFileSync(
      join(REPO_ROOT, "apps/web/src/components/inbox/filter-url.ts"),
      "utf8",
    );
    expect(web).toContain('params.set("awaiting", "true")');
    const android = readFileSync(CONTROLS.android, "utf8");
    expect(android).toMatch(/landOnAwaiting\(\)/);
    const ios = readFileSync(CONTROLS.ios, "utf8");
    expect(ios).toMatch(/landOnAwaiting\(\)/);
  });
});
