/**
 * No test gives an expiry a literal date that is still ahead.
 *
 * team.test.ts built every pending invite with an `expires_at` of 1 January
 * 2027. The accept route refuses an expired invite, so from that morning every
 * accept test would have answered 409 and the suite would have gone red with
 * nothing changed. A future expiry is written from `Date.now()`, unless the file
 * pins the clock its code reads, or the value goes to a fake that never compares
 * it against now (ALLOWED, with the reason).
 *
 * Failing output names file:line.
 */
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { sourceFiles, sourceText, stripComments } from "./source-tree";

const REPO = join(import.meta.dirname, "..", "..", "..", "..");

const TREES = [
  { dir: "apps/api/src", extensions: [".ts", ".tsx"], tests: /\.test\.tsx?$/ },
  { dir: "apps/web/src", extensions: [".ts", ".tsx"], tests: /\.test\.tsx?$/ },
  { dir: "packages/shared/src", extensions: [".ts", ".tsx"], tests: /\.test\.tsx?$/ },
  { dir: "apps/android/app/src/test", extensions: [".kt"], tests: /\.kt$/ },
  { dir: "apps/ios/LoonextTests", extensions: [".swift"], tests: /\.swift$/ },
];

const EXPIRY_KEYS = [
  "expires_at",
  "ends_at",
  "grace_until",
  "granted_through",
  "purge_after",
  "snoozed_until",
  "valid_until",
];

/** At or past this, a date is how the suite writes "never". */
const NEVER = Date.parse("2099-01-01T00:00:00Z");

interface Allowed {
  file: string;
  key: string;
  why: string;
}

const ALLOWED: Allowed[] = [
  {
    file: "apps/api/src/billing/pause.test.ts",
    key: "granted_through",
    why: "the fake's open prepayment; pauseEligibility only asks whether one is open",
  },
  {
    file: "apps/api/src/billing/prepay.test.ts",
    key: "granted_through",
    why: "prepayEligibility and amortisedMonthlyUsdCents read the fake row's presence and amounts, never its date",
  },
  {
    file: "apps/api/src/billing/prepay.test.ts",
    key: "grantedThrough",
    why: "remainingPrepaidInvoices counts against the fake subscription's current_period_end",
  },
  {
    file: "apps/api/src/routes/billing.test.ts",
    key: "granted_through",
    why: "the open_prepayment fake's row; the route prints the date and the RPC owns the arithmetic",
  },
  {
    file: "apps/api/src/routes/on-call.test.ts",
    key: "ends_at",
    why: "measured against the literal starts_at beside it, to show a year-long shift is refused",
  },
  {
    file: "apps/api/src/routes/trash.test.ts",
    key: "purge_after",
    why: "the api_list_trash fake's row, passed through to the response unread",
  },
  {
    file: "apps/web/src/components/invites/invite-banner.test.tsx",
    key: "expires_at",
    why: "the banner never reads expires_at; the server leaves expired invites out",
  },
  {
    file: "apps/web/src/components/settings/change-plan-prepaid.render.test.tsx",
    key: "granted_through",
    why: "the dialog reads the conversion figures, never the date",
  },
  {
    file: "apps/web/src/components/settings/ownership-card.test.tsx",
    key: "expires_at",
    why: "printed as the takeover deadline; whether the claim is ready comes from the server",
  },
  {
    file: "apps/web/src/components/settings/prepaid-year-card.render.test.tsx",
    key: "granted_through",
    why: "printed as the covered-until date, never compared against now",
  },
  {
    file: "apps/web/src/lib/settings/trash-row.test.ts",
    key: "purge_after",
    why: "the row-label tests never read it; the days-left tests pass their own now",
  },
  {
    file: "apps/android/app/src/test/kotlin/com/loonext/android/core/data/TrashRepositoryTest.kt",
    key: "purge_after",
    why: "decoded from the fake server's JSON and never compared against now",
  },
];

const camel = (key: string) => key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
const capital = (word: string) => word[0].toUpperCase() + word.slice(1);

/** `expires_at`, `expiresAt`, a prefixed `current_period_ends_at` or `trialEndsAt`, and `FUTURE`. */
const KEY = [
  ...EXPIRY_KEYS.flatMap((key) => [
    `(?:[A-Za-z0-9]+_)*${key}`,
    `(?:[a-z][A-Za-z0-9]*)?${capital(camel(key))}`,
    camel(key),
  ]),
  "FUTURE",
].join("|");

const ISO = String.raw`\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?`;
const QUOTE = String.raw`\\?["'\x60]`;

/** `key: "…"`, `key = "…"`, `"key":"…"` (escaped too, inside a string), and `key: new Date("…")`. */
const EXPIRY_LITERAL = new RegExp(
  String.raw`(?<![\w$])(${KEY})${QUOTE}?\s*[:=](?!=)\s*(?:(?:new\s+)?[\w.]+\(\s*)?${QUOTE}(${ISO})${QUOTE}`,
  "g",
);
const DATE_LITERAL = new RegExp(`${QUOTE}${ISO}${QUOTE}`, "g");

/** Fake timers, a fixed Clock, or a `now` the test passes in that is not the real clock. */
const PINS_THE_CLOCK = new RegExp(
  [
    String.raw`\bvi\.(?:setSystemTime|useFakeTimers)\(`,
    String.raw`\bClock\.fixed\(`,
    String.raw`\bnow(?:Ms)?\s*[:=](?!=)(?!\s*(?:new Date\(\)|Date\.now\(\)|Instant\.now\(\)|Date\(\)|System\.currentTimeMillis\(\)))`,
  ].join("|"),
);

interface Finding {
  line: number;
  key: string;
  value: string;
}

interface Scan {
  dates: number;
  expiries: number;
  findings: Finding[];
}

function futureExpiries(source: string, now: number): Scan {
  const code = stripComments(source);
  const dates = code.match(DATE_LITERAL)?.length ?? 0;
  const expiries = [...code.matchAll(EXPIRY_LITERAL)];
  if (PINS_THE_CLOCK.test(code)) return { dates, expiries: expiries.length, findings: [] };
  const findings = expiries.flatMap((match) => {
    const at = Date.parse(match[2]);
    if (!(at > now && at < NEVER)) return [];
    return [{ line: code.slice(0, match.index).split("\n").length, key: match[1], value: match[2] }];
  });
  return { dates, expiries: expiries.length, findings };
}

const now = Date.now();
// Read at collection, where the walk is not racing the per-test timeout.
const trees = TREES.map(({ dir, extensions, tests }) => {
  const files = sourceFiles(join(REPO, dir), extensions).filter((path) => tests.test(path));
  return {
    dir,
    files: files.map((path) => ({
      file: relative(REPO, path).replaceAll("\\", "/"),
      ...futureExpiries(sourceText(path), now),
    })),
  };
});

describe("no test gives an expiry a literal future date", () => {
  it("reads every tree it names, and finds expiry literals in them", () => {
    const files = trees.flatMap((tree) => tree.files);
    const dates = files.reduce((sum, file) => sum + file.dates, 0);
    const expiries = files.reduce((sum, file) => sum + file.expiries, 0);
    console.info(`test files scanned: ${files.length}, date literals: ${dates}, expiry literals: ${expiries}`);
    for (const tree of trees) expect(tree.files.length, `no test files under ${tree.dir}`).toBeGreaterThan(0);
    expect(expiries).toBeGreaterThan(0);
  });

  it("writes every future expiry from now, or pins the clock", () => {
    const allowed = (file: string, key: string) =>
      ALLOWED.some((entry) => entry.file === file && entry.key === key);
    const offenders = trees.flatMap((tree) =>
      tree.files.flatMap(({ file, findings }) =>
        findings
          .filter((finding) => !allowed(file, finding.key))
          .map((finding) => `${file}:${finding.line}  ${finding.key} = "${finding.value}"`),
      ),
    );
    expect(
      offenders,
      "this date is in the future today and in the past one day, and nothing pins the clock. " +
        "Write it as new Date(Date.now() + days * 86_400_000).toISOString(), " +
        "or, when no code compares it against now, add it to ALLOWED with the reason",
    ).toEqual([]);
  });

  it("allows nothing that is no longer there", () => {
    const stale = ALLOWED.filter(
      (entry) =>
        !trees.some((tree) =>
          tree.files.some(
            ({ file, findings }) =>
              file === entry.file && findings.some((finding) => finding.key === entry.key),
          ),
        ),
    ).map((entry) => `${entry.file} ${entry.key}`);
    expect(stale, "this ALLOWED entry matches no literal; delete it").toEqual([]);
  });

  it("flags the shapes a literal expiry takes, and only while it is ahead", () => {
    const year = new Date(now).getUTCFullYear();
    const ahead = `${year + 1}-01-01T00:00:00+00:00`;
    const past = `${year - 1}-01-01T00:00:00Z`;
    const flagged = (source: string) => futureExpiries(source, now).findings.map((f) => f.key);

    expect(flagged(`const FUTURE = "${ahead}";`)).toEqual(["FUTURE"]);
    expect(flagged(`invite({ expires_at: '${ahead}' })`)).toEqual(["expires_at"]);
    expect(flagged(`TrashItem(purge_after = "${ahead}")`)).toEqual(["purge_after"]);
    expect(flagged(`val body = """{"grace_until":"${ahead}"}"""`)).toEqual(["grace_until"]);
    expect(flagged(`"{\\"snoozed_until\\":\\"${ahead}\\"}"`)).toEqual(["snoozed_until"]);
    expect(flagged(`row({ trialEndsAt: new Date("${ahead}") })`)).toEqual(["trialEndsAt"]);
    expect(flagged(`row({ current_period_ends_at: "${ahead}" })`)).toEqual(["current_period_ends_at"]);

    expect(flagged(`const FUTURE = "${past}";`)).toEqual([]);
    expect(flagged(`row({ expires_at: "2099-01-01T00:00:00Z" })`)).toEqual([]);
    expect(flagged(`// expires_at: "${ahead}"`)).toEqual([]);
    expect(flagged(`row({ created_at: "${ahead}" })`)).toEqual([]);
    expect(flagged(`vi.setSystemTime(0);\nrow({ expires_at: "${ahead}" })`)).toEqual([]);
    expect(flagged(`daysLeft(row, { now: NOW });\nrow({ expires_at: "${ahead}" })`)).toEqual([]);
    expect(flagged(`const now = new Date();\nrow({ expires_at: "${ahead}" })`)).toEqual(["expires_at"]);
  });
});
