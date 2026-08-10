/**
 * #238 — APP-LAYOUT-V2 §7's roles and live regions, checked mechanically.
 *
 * §7 is a good specification. Every rule below is already implemented, and
 * that is precisely the problem this file solves: a spec whose only
 * enforcement is that somebody once read it decays the way #338's parity did.
 * Nothing here is new behaviour. What is new is that removing any of it fails.
 *
 * ── TWO KINDS OF CHECK, AND WHY BOTH ──────────────────────────────────────
 *
 * **Structural** (R-1..R-3) generalise: they hold for code nobody has written
 * yet. A new segmented control gets caught by R-1 without anybody updating
 * this file, which is the only kind of check that keeps up with a product.
 *
 * **The roster** (R-4) does not generalise, and is here for the rules a
 * pattern cannot express — "the composer's send is a real button", "incoming
 * messages announce". Those are claims about specific code, so they are
 * written down as specific code. The roster is the weaker half and is
 * deliberately small.
 *
 * ── WHAT THIS DOES NOT COVER ──────────────────────────────────────────────
 *
 * Contrast, hit targets and accessible names are measured on a rendered page
 * by `scripts/theme-audit.mjs`; reduced motion by `reduced-motion.test.ts`;
 * dragging alternatives by `dragging-alternatives.test.ts`. §7's keyboard PATH
 * — rail → list → thread → composer → panel, focus never trapped — is a
 * rendered, focus-order question and is not answerable here. Saying so matters:
 * a file called "roles" that quietly implied it had checked the tab order
 * would be worse than one that names its edge.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sourceFiles, sourceText, stripComments } from "@/test/source-tree";

const SRC = join(process.cwd(), "src");

/**
 * §7's named rules, and the code that satisfies each.
 *
 * `code` must appear in `file` with comments stripped — so a rule cannot be
 * satisfied by a docblock that merely talks about it, which is the failure
 * #519 found across this codebase and which this family of guards keeps
 * re-learning.
 */
const SPEC_RULES: readonly {
  rule: string;
  file: string;
  code: string;
  why: string;
}[] = [
  {
    rule: "§7 — incoming messages announce",
    file: "components/thread/message-list.tsx",
    code: 'aria-live="polite"',
    why:
      "A screen-reader user has no other signal that a customer replied. " +
      "Polite rather than assertive so it waits for a gap instead of cutting " +
      "across whatever they are reading.",
  },
  {
    rule: "§7 — the per-message action is a toggle, not a button that changes name",
    file: "components/thread/message-actions.tsx",
    code: "aria-pressed={done}",
    why:
      "Done/not-done is a STATE. Without aria-pressed a screen reader " +
      "announces a button and never says whether the job is finished, which " +
      "is the entire information the control carries.",
  },
  {
    rule: "§7 — filter chips say what removing them does",
    file: "components/inbox/filter-bar.tsx",
    // #228: the sentence moved to the catalogue, so the rule is now satisfied
    // by the LOOKUP that still names the chip. The label is interpolated the
    // same way and `MessageKey` is typed, so this cannot be satisfied by a
    // constant that says nothing.
    code: 'aria-label={t("inbox.removeFilterAria", { label })}',
    why:
      "The visible label is the filter's name; the button is an X. Without " +
      "this, a row of active filters reads as a row of identical buttons.",
  },
  {
    rule: "§7 — filter chips say what removing them does (tasks)",
    file: "components/tasks/task-filter-bar.tsx",
    // #228: the same move as its sibling above — and this guard caught the one
    // of the pair that had been updated a moment later than the other, which is
    // exactly the drift its own `why` was written about.
    code: 'aria-label={t("tasks.removeFilterAria", { label })}',
    why: "The same control on the other filter bar, which drifted apart once already.",
  },
  {
    rule: "§7 — the composer's send state is announced, not just styled",
    file: "components/thread/composer.tsx",
    code: 'aria-live="polite"',
    why:
      "§7 requires the send button's disabled state to be ANNOUNCED. A " +
      "greyed button with no announcement leaves somebody pressing a control " +
      "that silently does nothing.",
  },
];

/** Files whose ARIA is the library's, not ours, and is tested upstream. */
const VENDOR = ["components/ui/"];

describe("#238 APP-LAYOUT-V2 §7 roles and live regions", () => {
  const files = sourceFiles(SRC, [".tsx"]).filter(
    (file) => !/\.test\.tsx?$/.test(file),
  );

  /** Every non-test, non-vendor source with its comments blanked out. */
  const corpus = files
    .filter((file) => !VENDOR.some((dir) => relative(file).startsWith(dir)))
    .map((file) => ({ rel: relative(file), code: stripComments(sourceText(file)) }));

  it("R-1: every tab announces whether it is the selected one", () => {
    // The structural rule that generalises. A `role="tab"` without
    // `aria-selected` is worse than no role at all: it promises a screen
    // reader that this is a tab set and then withholds the one fact a tab
    // set exists to convey, so the user hears four tabs and cannot tell
    // which view they are looking at.
    const offenders = corpus
      .filter(({ code }) => /role="tab"/.test(code) && !/aria-selected/.test(code))
      .map(({ rel }) => rel);

    expect(
      offenders,
      'These files declare role="tab" without aria-selected. §7 binds both ' +
        "together — a tab that never says it is selected leaves a screen " +
        "reader user unable to tell which view they are in:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("R-2: a tablist actually contains tabs", () => {
    // The mirror. `role="tablist"` on a container whose children are plain
    // buttons is a container that announces a tab set and then presents
    // something else — the assistive tech believes the role, not the markup.
    const offenders = corpus
      .filter(({ code }) => /role="tablist"/.test(code) && !/role="tab"/.test(code))
      .map(({ rel }) => rel);

    expect(
      offenders,
      'These files declare role="tablist" but nothing inside carries ' +
        'role="tab". Either the children need the role or the container ' +
        "should not claim to be a tab set:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("R-3: a live region says how urgently it interrupts", () => {
    // `aria-live` without a politeness value is undefined behaviour across
    // screen readers — some treat it as off. §7 asks specifically for polite,
    // because assertive cuts across whatever the user is mid-sentence on.
    const offenders = corpus
      .filter(({ code }) => /aria-live=(?!"(?:polite|assertive|off)")/.test(code))
      .map(({ rel }) => rel);

    expect(
      offenders,
      "These files set aria-live without a literal politeness value. " +
        "Screen readers disagree about what that means, and some ignore the " +
        "region entirely:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("R-4: every §7 rule with a named implementation still has it", () => {
    const missing: string[] = [];
    for (const spec of SPEC_RULES) {
      const hit = corpus.find(({ rel }) => rel === spec.file);
      if (!hit) {
        missing.push(`${spec.file} — file is gone (rule: ${spec.rule})`);
        continue;
      }
      if (!hit.code.includes(spec.code)) {
        missing.push(`${spec.file} — lost \`${spec.code}\`. ${spec.rule}: ${spec.why}`);
      }
    }

    expect(missing, "APP-LAYOUT-V2 §7 rules no longer implemented:\n  " +
      missing.join("\n  ")).toEqual([]);
  });

  it("R-5: reads the client, so a passing run means something", () => {
    // The failure this whole family exists to catch: a scan that walks nothing
    // reports success forever. Asserted on the FILTERED corpus, because that
    // is what every rule above actually reads.
    expect(corpus.length).toBeGreaterThan(200);
    // And the rules are looking at real markup rather than an empty haystack:
    // if nothing in the app declared a tab, R-1 and R-2 would be vacuous.
    expect(corpus.some(({ code }) => /role="tablist"/.test(code))).toBe(true);
    expect(corpus.some(({ code }) => /aria-live=/.test(code))).toBe(true);
  });
});

/** A path as the roster spells it: relative to src/, forward slashes. */
function relative(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const at = normalized.lastIndexOf("/src/");
  return at === -1 ? normalized : normalized.slice(at + "/src/".length);
}
