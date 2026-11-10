/**
 * #720: every date the product shows goes through one formatter.
 *
 * ── THE DEFECT THIS PINS ──────────────────────────────────────────────────
 *
 * About two dozen files each drew their own date: `date-fns` in some,
 * `toLocaleDateString` in others, a hand-rolled `Intl.DateTimeFormat` in a
 * third. The same moment read "Sep 9" on one screen and "9:42 AM" on the next,
 * and none of them could be hovered for the exact time. `formatTimestamp` (and
 * `<Timestamp>` over it) is now the one place that decides the label, and the
 * tooltip carries the exact time and zone.
 *
 * ── WHAT IS CHECKED ───────────────────────────────────────────────────────
 *
 * T-0  the scan read source files (an empty scan proves nothing).
 * T-1  outside `lib/format/time.ts` and `components/ui/timestamp.tsx`, no file
 *      calls `formatRelativeTime(`, imports `date-fns`, calls
 *      `toLocaleDateString(` / `toLocaleTimeString(`, calls `toLocaleString(`
 *      with date or time options, builds an `Intl.DateTimeFormat(`, or hands
 *      `formatAbsoluteDateTime(` to a `title=` (that hover is `<Timestamp>`'s
 *      job), unless the roster below says why.
 * T-2  the roster is closed: an entry whose file no longer makes that call
 *      FAILS, so an excuse cannot outlive the code it excuses.
 *
 * Machine formats are not dates a person reads and are not flagged:
 * `Intl.DateTimeFormat().resolvedOptions()` asks for a ZONE NAME, and
 * `toLocaleString(locale)` with no date option is a number.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sourceFiles, sourceText, stripComments } from "@/test/source-tree";

const SRC = join(process.cwd(), "src");

/** The two files that ARE the formatter. */
const FORMATTER_FILES = ["lib/format/time.ts", "components/ui/timestamp.tsx"];

const relative = (path: string): string =>
  path.slice(SRC.length + 1).replace(/\\/g, "/");

const files = sourceFiles(SRC, [".ts", ".tsx"])
  .filter((file) => !/\.test\.tsx?$/.test(file))
  .map((file) => ({ rel: relative(file), text: stripComments(sourceText(file)) }))
  .filter((file) => !FORMATTER_FILES.includes(file.rel));

/** The text of the argument list that opens at `open` (just after the `(`). */
function argumentList(text: string, open: number): string {
  let depth = 1;
  let end = open;
  for (; end < text.length && depth > 0; end += 1) {
    const char = text[end];
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
  }
  return text.slice(open, end - 1);
}

const DATE_OPTION = /\b(?:weekday|hour|minute|month|day|year|dateStyle|timeStyle|timeZone)\b/;

interface Rule {
  /** The name the roster uses. */
  call: string;
  pattern: RegExp;
  /** Narrows a match; the argument list is passed. Default: every match counts. */
  counts?: (list: string, line: string) => boolean;
}

const RULES: readonly Rule[] = [
  { call: "formatRelativeTime(", pattern: /\bformatRelativeTime\(/g },
  { call: "date-fns", pattern: /from\s+["']date-fns(?:\/[^"']*)?["']/g },
  { call: "toLocaleDateString(", pattern: /\.toLocaleDateString\(/g },
  { call: "toLocaleTimeString(", pattern: /\.toLocaleTimeString\(/g },
  {
    call: "toLocaleString(",
    pattern: /\.toLocaleString\(/g,
    counts: (list) => DATE_OPTION.test(list),
  },
  {
    call: "Intl.DateTimeFormat(",
    pattern: /\bIntl\.DateTimeFormat\(/g,
    counts: (_list, line) => !/\.resolvedOptions\(\)/.test(line),
  },
  { call: "title={formatAbsoluteDateTime(", pattern: /title=\{formatAbsoluteDateTime\(/g },
];

interface Hit {
  rel: string;
  line: number;
  call: string;
}

function findHits(): Hit[] {
  const hits: Hit[] = [];
  for (const { rel, text } of files) {
    const lines = text.split("\n");
    for (const rule of RULES) {
      for (const match of text.matchAll(rule.pattern)) {
        const index = match.index ?? 0;
        const line = text.slice(0, index).split("\n").length;
        const list = argumentList(text, index + match[0].length);
        if (rule.counts && !rule.counts(list, lines[line - 1] ?? "")) continue;
        hits.push({ rel, line, call: rule.call });
      }
    }
  }
  return hits;
}

/**
 * Calls that are right, and why. One entry excuses a call in a file; the file
 * must still make it. Most are a CALENDAR DAY with no time of day, which is
 * not a timestamp: a sentence that says "on {date}" ("le {date}" in French)
 * breaks if the label turns into "Yesterday" or "3:42 PM".
 */
const ROSTER: readonly { file: string; call: string; reason: string }[] = [
  {
    file: "app/(app)/contacts/[id]/page.tsx",
    call: "toLocaleDateString(",
    reason: 'The record line says "Added by Sam on {date}" ("le {date}" in French): a calendar day, and a relative word breaks the sentence.',
  },
  {
    file: "app/(app)/contacts/[id]/page.tsx",
    call: "Intl.DateTimeFormat(",
    reason: "Reads what the clock says in the contact's zone right now; it is a clock, not a moment.",
  },
  {
    file: "app/(app)/settings/billing/page.tsx",
    call: "toLocaleDateString(",
    reason: "A billing-period end, stated as a calendar day.",
  },
  {
    file: "app/(app)/settings/usage/page.tsx",
    call: "toLocaleDateString(",
    reason: 'Billing-period bounds ("Jul 1 to Jul 31") and month names on the history bars: calendar days and months.',
  },
  {
    file: "app/(app)/settings/whats-new/page.tsx",
    call: "toLocaleDateString(",
    reason: "A release date is a date with no time of day, pinned to UTC.",
  },
  {
    file: "app/(app)/settings/workspace/page.tsx",
    call: "Intl.DateTimeFormat(",
    reason: "Shows what the clock reads now in the workspace's zone while it is being chosen.",
  },
  {
    file: "app/(marketing)/compare/verification.ts",
    call: "Intl.DateTimeFormat(",
    reason: "A month-and-year dateline on a marketing page, UTC and in the route's language.",
  },
  {
    file: "app/onboarding/setting-up/page.tsx",
    call: "toLocaleDateString(",
    reason: "The carrier's switch-over day for a port: a day with no time of day.",
  },
  {
    file: "components/contacts/contact-timeline.tsx",
    call: "toLocaleTimeString(",
    reason: "The time of day under a day heading that already names the date.",
  },
  {
    file: "components/contacts/contact-timeline.tsx",
    call: "toLocaleDateString(",
    reason: "The day heading that groups the timeline: a calendar day, never a time.",
  },
  {
    file: "components/inbox/conversation-row.tsx",
    call: "title={formatAbsoluteDateTime(",
    reason: "The row's stretched link covers the time, so the link itself carries the exact time of the last message.",
  },
  {
    file: "components/inbox/e164.ts",
    call: "Intl.DateTimeFormat(",
    reason: "The clock where a number is: one formatter is read back as an hour number for the quiet-hours test.",
  },
  {
    file: "components/marketing/whats-new-page.tsx",
    call: "toLocaleDateString(",
    reason: "A release date on a marketing page: a date with no time of day, UTC, in the route's language.",
  },
  {
    file: "components/public/quote-page.tsx",
    call: "Intl.DateTimeFormat(",
    reason: 'A stranger\'s quote page says "Valid until 23 August": a date, in Canadian English.',
  },
  {
    file: "components/settings/cancellation-answer.tsx",
    call: "toLocaleDateString(",
    reason: "The day a held number is released, in UTC because the release job runs on that clock.",
  },
  {
    file: "components/settings/change-plan-dialog.tsx",
    call: "toLocaleDateString(",
    reason: "The day a plan change starts, at a billing-period boundary.",
  },
  {
    file: "components/settings/closed-dates-card.tsx",
    call: "toLocaleDateString(",
    reason: "A closed date is a YYYY-MM-DD string with no time of day.",
  },
  {
    file: "components/settings/held-numbers-card.tsx",
    call: "toLocaleDateString(",
    reason: 'The sentence says "on hold since {day}" ("depuis le {day}"): a calendar day.',
  },
  {
    file: "components/settings/missed-while-off.tsx",
    call: "toLocaleDateString(",
    reason: 'Part of "today / yesterday / on {date}", its own day wording.',
  },
  {
    file: "components/settings/number-card.tsx",
    call: "toLocaleDateString(",
    reason: '"Released {date}" ("Libéré le {date}"): a calendar day.',
  },
  {
    file: "components/settings/number-health-notice.tsx",
    call: "toLocaleDateString(",
    reason: '"Since {date}" ("Depuis le {date}"): a calendar day.',
  },
  {
    file: "components/settings/off-ramp-card.tsx",
    call: "toLocaleDateString(",
    reason: "A deadline day drawn in UTC, the clock the release job runs on; the reader's zone would be a day out.",
  },
  {
    file: "components/settings/pause-plan.tsx",
    call: "toLocaleDateString(",
    reason: 'The day a plan was paused, inside "since {date}" ("depuis le {date}").',
  },
  {
    file: "components/settings/port-card.tsx",
    call: "toLocaleDateString(",
    reason: "The carrier's switch-over day: a day with no time of day.",
  },
  {
    file: "components/settings/prepaid-year-card.tsx",
    call: "toLocaleDateString(",
    reason: "The day a prepaid year runs through: a calendar day.",
  },
  {
    file: "components/settings/registration-section.tsx",
    call: "toLocaleDateString(",
    reason: 'Step captions say "Submitted on {date}" ("le {date}"): a calendar day.',
  },
  {
    file: "components/settings/text-enable-card.tsx",
    call: "toLocaleDateString(",
    reason: '"Started {date}" ("Commencé le {date}"): a calendar day.',
  },
  {
    file: "components/settings/two-factor-card.tsx",
    call: "toLocaleDateString(",
    reason: "The date goes into the name stored on a new factor, which is text the user keeps, not a label drawn on a screen.",
  },
  {
    file: "components/tasks/task-planning.ts",
    call: "Intl.DateTimeFormat(",
    reason: "A weekday NAME for a repeat rule, built from a fixed Monday; not a moment.",
  },
  {
    file: "components/tasks/views/calendar-view.tsx",
    call: "date-fns",
    reason: "Calendar grid: day keys (yyyy-MM-dd), the month title and the day numbers, not timestamps.",
  },
  {
    file: "components/thread/clusters.ts",
    call: "date-fns",
    reason: "Day dividers and their yyyy-MM-dd keys: a divider names a calendar day, never a time.",
  },
  {
    file: "components/thread/gallery-grouping.ts",
    call: "date-fns",
    reason: "Gallery day headings: a calendar day, never a time.",
  },
  {
    file: "components/thread/send-later-menu.tsx",
    call: "toLocaleString(",
    reason: 'The "that\'s 8:00 AM their time" readout, compared against the sender\'s clock by string.',
  },
  {
    file: "components/thread/send-later-menu.tsx",
    call: "Intl.DateTimeFormat(",
    reason: "An hour difference computed from a parsed number; never shown as formatted.",
  },
  {
    file: "components/thread/snooze-menu.tsx",
    call: "toLocaleTimeString(",
    reason: "The return label's own sentence shapes, set by the shared `snoozeReturnShape` and checked against the phones.",
  },
  {
    file: "components/thread/snooze-menu.tsx",
    call: "toLocaleDateString(",
    reason: "Same label: the weekday and day names inside the shared snooze sentence shapes.",
  },
  {
    file: "lib/marketing/status-feed.ts",
    call: "Intl.DateTimeFormat(",
    reason: "The public status page's confirmed-on date: a UTC calendar day in the route's language.",
  },
];

const hits = findHits();
const where = (hit: Hit): string => `${hit.rel}:${hit.line}  ${hit.call}`;

describe("#720 every date goes through one formatter", () => {
  it(`T-0: the scan read ${files.length} source files and found the calls it is about`, () => {
    expect(files.length, "the scan read no source files").toBeGreaterThan(0);
    // The roster's own calls are the proof the patterns still match something.
    expect(hits.length, `no calls found in ${files.length} files`).toBeGreaterThan(0);
  });

  it("T-1: no date is drawn outside the formatter unless the roster says why", () => {
    const unlisted = hits.filter(
      (hit) =>
        !ROSTER.some((entry) => entry.file === hit.rel && entry.call === hit.call),
    );
    expect(
      unlisted.map(where),
      `Scanned ${files.length} files. These draw a date or time themselves. ` +
        "Use `<Timestamp at={iso} />` in JSX, or `formatTimestamp(iso, { style, t })` " +
        "inside a sentence, an aria-label or a toast; a calendar day with no time of " +
        "day may go on the ROSTER with the reason:\n  " +
        unlisted.map(where).join("\n  "),
    ).toEqual([]);
  });

  it("T-2: the roster excuses code that still exists", () => {
    const stale = ROSTER.filter(
      (entry) => !hits.some((hit) => hit.rel === entry.file && hit.call === entry.call),
    );
    expect(
      stale.map((entry) => `${entry.file}  ${entry.call}`),
      "These roster entries no longer match a call. Delete them:",
    ).toEqual([]);
  });

  it("T-3: every roster entry gives a reason", () => {
    expect(ROSTER.filter((entry) => entry.reason.trim().length < 15)).toEqual([]);
  });
});
