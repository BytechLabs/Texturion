/**
 * #520 — the on-my-way text is the same sentence on web, Android and iOS.
 *
 * A crew comparing the phone and the laptop must not find two different
 * messages going to the same customer, and the issue says why the sentence is
 * shared at all: three clients writing their own "on my way" is three
 * products.
 *
 * The word that matters most is "about". A tech who says twenty and arrives at
 * twenty-eight has not broken a promise; a client that dropped the hedge would
 * be making a claim about traffic from a van, and the customer who writes the
 * time down is the one who is annoyed at the twenty-first minute.
 */
import { join } from "node:path";

import {
  ON_MY_WAY_COPY,
  ON_MY_WAY_PRESETS,
  onMyWayText,
} from "@loonext/shared";
import { describe, expect, it } from "vitest";

import { parityCode } from "@/components/contacts/parity-source";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

/** Where the vocabulary is hand-ported. */
const PORTS: Record<string, string> = {
  android: join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/core/compose/OnMyWay.kt",
  ),
  ios: join(REPO_ROOT, "apps/ios/Loonext/Core/OnMyWay.swift"),
};

/** Where the control is built. */
const SURFACES: Record<string, string> = {
  web: join(REPO_ROOT, "apps/web/src/components/thread/on-my-way.tsx"),
  android: join(
    REPO_ROOT,
    "apps/android/app/src/main/kotlin/com/loonext/android/features/compose/Composer.kt",
  ),
  ios: join(REPO_ROOT, "apps/ios/Loonext/Features/Compose/Composer.swift"),
};

describe("#520 the on-my-way text reads the same everywhere", () => {
  it("reads every source, so a passing run means something", () => {
    for (const [platform, path] of Object.entries({ ...PORTS, ...SURFACES })) {
      expect(parityCode(path).length, platform).toBeGreaterThan(1000);
    }
  });

  it("hedges the arrival on every client", () => {
    // THE WORD THAT MATTERS. Without it the sentence promises a minute that
    // nobody in traffic can promise.
    //
    // THE SEPARATOR MATTERS TOO, for a different reason. This pinned an em
    // dash, and the three clients agreed on it perfectly - which is what a
    // parity test is for, and also how the same expensive character survived in
    // all three at once. An em dash is outside GSM-7, so it drops the whole
    // message to UCS-2 at 67 units per segment instead of 153, on a text sent
    // once per visit. Parity was never the missing check; nothing was asking
    // what the agreed sentence cost to deliver.
    // `packages/shared/src/sms-copy-encoding.test.ts` asks that now.
    for (const [platform, path] of Object.entries(PORTS)) {
      expect(parityCode(path), `${platform}: hedges`).toContain(
        "On my way - about ",
      );
    }
    expect(onMyWayText(20)).toContain("about");
  });

  it("offers the same choices, in the same order", () => {
    // A phone offering 15 and a laptop offering 20 is two products. The order
    // is part of it: the first chip is the one thumbed by accident.
    const android = parityCode(PORTS.android);
    const ios = parityCode(PORTS.ios);
    const list = [...ON_MY_WAY_PRESETS].join(", ");
    expect(android).toContain(`listOf(${list})`);
    expect(ios).toContain(`[${list}]`);
  });

  it("says the same three things on every client", () => {
    // The prompt and the note are distinctive enough to check as substrings.
    for (const sentence of [ON_MY_WAY_COPY.prompt, ON_MY_WAY_COPY.gated_note]) {
      for (const [platform, path] of Object.entries(PORTS)) {
        expect(parityCode(path), `${platform}: ${sentence}`).toContain(sentence);
      }
    }
  });

  it("calls the control what a crew calls it, not what a dispatcher does", () => {
    // Asserted as the CONSTANT'S VALUE. Checked as a substring this passed
    // with the action renamed to "Send ETA", because the sentence it sends
    // starts with the same three words — found by making exactly that change
    // and watching the test stay green.
    const declaration: Record<string, string> = {
      android: `const val ACTION = "${ON_MY_WAY_COPY.action}"`,
      ios: `static let action = "${ON_MY_WAY_COPY.action}"`,
    };
    for (const [platform, path] of Object.entries(PORTS)) {
      expect(parityCode(path), `${platform}: action name`).toContain(
        declaration[platform],
      );
    }
    expect(ON_MY_WAY_COPY.action.toLowerCase()).not.toContain("eta");
  });

  it("warns that the tap sends, on the surface that does the sending", () => {
    // Asserted on the SURFACE, not the vocabulary: a constant nobody renders
    // is a sentence nobody reads. Somebody expecting a picker and getting a
    // sent message has texted a customer by accident, which is the one
    // irreversible thing this feature can do.
    const identifier: Record<string, string> = {
      web: "ON_MY_WAY_COPY.gated_note",
      android: "OnMyWay.Copy.GATED_NOTE",
      ios: "OnMyWay.Copy.gatedNote",
    };
    for (const [platform, path] of Object.entries(SURFACES)) {
      expect(
        parityCode(path).includes(identifier[platform]),
        `${platform}: the send warning is never rendered`,
      ).toBe(true);
    }
  });

  it("hides the control rather than disabling it, on every client", () => {
    // "Absent when the thread has no job due today, rather than present and
    // inert" is an acceptance criterion, and a disabled button satisfies the
    // letter of a screenshot while failing it.
    const guard: Record<string, RegExp> = {
      web: /if \(!hasJobToday\) return null;/,
      android: /if \(!noteOnly && hasJobToday/,
      ios: /if !noteOnly, hasJobToday/,
    };
    for (const [platform, path] of Object.entries(SURFACES)) {
      expect(parityCode(path), `${platform}: hides when there is no job`)
        .toMatch(guard[platform]);
    }
  });

  it("is never offered on a note, which goes to the crew", () => {
    // "On my way" is for the customer. A notes-only member has no recipient to
    // tell, and a note that says it would be a message to colleagues about a
    // van they are not in.
    //
    // Checked where each client DECIDES, which is not the same file on all
    // three: the phones build the control inline in their composer, and web
    // mounts a component from its own. Pointing all three at the component
    // file failed on web for that reason, which is the check working.
    // Matched on the MOUNT, not on the file. `composer.tsx` uses `!noteOnly`
    // for five other things, so a bare /!noteOnly/ passed with the gate taken
    // off this control entirely — found by removing it.
    const gate: Record<string, RegExp> = {
      // The gate must still sit immediately before the mount. The optional
      // paren and whitespace let the JSX wrap onto its own line — which it did
      // once the component took a second prop — while still allowing nothing
      // between the condition and the component.
      web: /!noteOnly && \(?\s*<OnMyWay/,
      android: /if \(!noteOnly && hasJobToday/,
      ios: /if !noteOnly, hasJobToday/,
    };
    const decider: Record<string, string> = {
      web: join(REPO_ROOT, "apps/web/src/components/thread/composer.tsx"),
      android: SURFACES.android,
      ios: SURFACES.ios,
    };
    for (const [platform, path] of Object.entries(decider)) {
      expect(parityCode(path), `${platform}: not on a note`).toMatch(
        gate[platform],
      );
    }
  });
});
