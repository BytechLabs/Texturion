import { ATTRIBUTION_PARAMS, sanitizeAttributionValue } from "@loonext/shared";
import { describe, expect, it } from "vitest";

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  redactEmails,
  redactPhones,
  redactTokenPaths,
  scrubText,
  scrubUnknown,
  scrubUrl,
  stripQueryAndHash,
  TOKEN_PATH_PREFIXES,
  TOKEN_REDACTED,
} from "./scrub";

const PHONE = "+14165551234";
// A user-typed search term: not digit-shaped, so no redaction pattern can
// catch it — it must be STRIPPED with the query string it travels in.
const SEARCH_TERM = "Jane Doe";

describe("redactPhones (SPEC §10 E.164 pattern)", () => {
  it("redacts +1-prefixed, bare-11-digit, and long international runs", () => {
    expect(redactPhones(`a ${PHONE} b`)).toBe("a [phone redacted] b");
    expect(redactPhones("14165551234")).toBe("[phone redacted]");
    expect(redactPhones("4165551234567")).toBe("[phone redacted]");
    expect(redactPhones("+442071234567")).toBe("[phone redacted]");
  });

  it("catches URL-encoded numbers inside URLs", () => {
    expect(redactPhones("/v1/contacts?phone=%2B14165551234")).toBe(
      "/v1/contacts?phone=[phone redacted]",
    );
  });

  it("leaves short digit runs and ids alone", () => {
    expect(redactPhones("error code 40300")).toBe("error code 40300");
    expect(redactPhones("id 123456789")).toBe("id 123456789");
    expect(redactPhones("6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01")).toBe(
      "6f0c2f0e-6a5a-4bfa-9b6e-2d6d1a6c9e01",
    );
  });
});

describe("#651 a UUID is never mistaken for a phone number", () => {
  // Both end in a group that the bare phone pattern reads as ten digits: twelve
  // decimal digits, and ten digits followed by two hex letters.
  const UUIDS = [
    "550e8400-e29b-41d4-a716-446655440000",
    "0192f1a3-7c4e-7b2a-9f00-1234567890ab",
  ];

  it.each(UUIDS)("keeps %s whole on its own", (uuid) => {
    expect(redactPhones(uuid)).toBe(uuid);
  });

  it.each(UUIDS)("keeps %s whole inside a URL path", (uuid) => {
    expect(redactPhones(`/v1/companies/${uuid}/messages`)).toBe(
      `/v1/companies/${uuid}/messages`,
    );
    expect(scrubUrl(`https://api.loonext.com/v1/contacts/${uuid}?q=x`)).toBe(
      `https://api.loonext.com/v1/contacts/${uuid}`,
    );
  });

  it.each(UUIDS)("still redacts a real phone number next to %s", (uuid) => {
    expect(redactPhones(`${uuid} called ${PHONE}`)).toBe(
      `${uuid} called [phone redacted]`,
    );
    expect(redactPhones(`${PHONE} then ${uuid}`)).toBe(
      `[phone redacted] then ${uuid}`,
    );
    expect(redactPhones(`/v1/companies/${uuid}/contacts?phone=%2B14165551234`)).toBe(
      `/v1/companies/${uuid}/contacts?phone=[phone redacted]`,
    );
    expect(redactPhones(`${uuid},${PHONE}`)).toBe(
      `${uuid},[phone redacted]`,
    );
  });

  it("keeps a UUID whole in every field a scrubber walks", () => {
    const uuid = UUIDS[0];
    expect(
      scrubUnknown({
        message: `company ${uuid} failed`,
        tags: { company_id: uuid },
        extra: { ids: [uuid] },
      }),
    ).toEqual({
      message: `company ${uuid} failed`,
      tags: { company_id: uuid },
      extra: { ids: [uuid] },
    });
  });
});

describe("scrubText and scrubUnknown (SPEC §10: no names, emails or phone numbers)", () => {
  it("redacts an email address and a phone number in free text", () => {
    expect(scrubText("+16135551234 a@b.co")).toBe("[phone redacted] [email redacted]");
    expect(redactEmails("write to dana@brightside.example now")).toBe(
      "write to [email redacted] now",
    );
  });

  it("leaves a package path that merely contains an @ alone", () => {
    expect(redactEmails("at node_modules/@loonext/shared/dist/index.js")).toBe(
      "at node_modules/@loonext/shared/dist/index.js",
    );
  });

  it("strips name keys, cuts URL keys and redacts the rest, at any depth", () => {
    expect(
      scrubUnknown({
        contact_name: "Jane Doe",
        $current_url: `https://app.loonext.com/inbox?q=${encodeURIComponent(SEARCH_TERM)}`,
        nested: [{ value: `call ${PHONE}` }],
      }),
    ).toEqual({
      contact_name: "[name redacted]",
      $current_url: "https://app.loonext.com/inbox",
      nested: [{ value: "call [phone redacted]" }],
    });
  });
});

describe("#296 the duplicated allow-list cannot drift", () => {
  it("matches @loonext/shared exactly", () => {
    // scrub.ts cannot IMPORT the shared list: it is reached from
    // instrumentation-client.ts, which Next bundles without a TypeScript
    // loader for workspace sources, so the import fails the production build
    // on the first `type` keyword — and only in the build, which is why it
    // reached main. The copy is deliberate; this is what keeps it honest.
    for (const key of ATTRIBUTION_PARAMS) {
      expect(stripQueryAndHash(`/x?${key}=abc`), key).toBe(`/x?${key}=abc`);
    }
    // And the value rule agrees too, not just the key list.
    for (const bad of ["Jane Doe", "a".repeat(65), ""]) {
      expect(sanitizeAttributionValue(bad)).toBeNull();
      expect(stripQueryAndHash(`/x?utm_source=${encodeURIComponent(bad)}`)).toBe("/x");
    }
  });
});

describe("#296 the campaign allow-list is the ONLY thing that survives", () => {
  it("keeps utm and the click ids", () => {
    // Without these there is no way to tell whether /compare produces a
    // signup, which is six landing pages of investment with no feedback loop.
    expect(stripQueryAndHash("/compare?utm_source=google&utm_medium=cpc")).toBe(
      "/compare?utm_source=google&utm_medium=cpc",
    );
    expect(stripQueryAndHash("/?gclid=Cj0KCQ")).toBe("/?gclid=Cj0KCQ");
  });

  it("still cuts everything this function was written to cut", () => {
    // The whole reason the query string is dropped: it round-trips typed
    // contact names and message words through the inbox filter and the search
    // palette. Adding an allow-list must not reopen that.
    expect(stripQueryAndHash("/inbox?q=Jane+Doe")).toBe("/inbox");
    expect(stripQueryAndHash("/inbox?q=Jane&utm_source=google")).toBe(
      "/inbox?utm_source=google",
    );
    expect(stripQueryAndHash("/signup?email=jane%40example.com")).toBe("/signup");
    expect(stripQueryAndHash("/x?ref=ABCD1234")).toBe("/x");
  });

  it("refuses a campaign value that is not campaign-shaped", () => {
    // The parameter name is allow-listed; the VALUE still has to look like a
    // campaign token, so ?utm_source=<a name> does not smuggle one through.
    expect(stripQueryAndHash("/x?utm_source=Jane%20Doe")).toBe("/x");
    expect(stripQueryAndHash("/x?utm_campaign=" + "a".repeat(200))).toBe("/x");
  });

  it("drops the fragment even when a campaign key survives", () => {
    expect(stripQueryAndHash("/compare?utm_source=google#rows")).toBe(
      "/compare?utm_source=google",
    );
  });
});

describe("stripQueryAndHash (shared with lib/analytics/posthog.ts)", () => {
  it("cuts at the first ? or #, and passes clean URLs through", () => {
    expect(stripQueryAndHash("/inbox?q=Jane#top")).toBe("/inbox");
    expect(stripQueryAndHash("https://x.test/p#frag")).toBe("https://x.test/p");
    expect(stripQueryAndHash("/contacts")).toBe("/contacts");
  });
});

// ---------------------------------------------------------------------------
// #558 — a path segment that IS the secret
// ---------------------------------------------------------------------------

/**
 * The SHAPE of a token D75 mints — 43 base64url characters — with none of the
 * entropy. Built rather than written: a realistic literal here is
 * indistinguishable from a leaked one, and the secret scanner flagged the first
 * version of this line, correctly. It also reads better in a failure message.
 */
const TOKEN = `not-a-real-token-${"x".repeat(26)}`;

describe("#558 tokenised paths never leave in full", () => {
  it("redacts the segment after each token-bearing prefix", () => {
    expect(redactTokenPaths(`/photos/${TOKEN}`)).toBe("/photos/[token]");
    expect(redactTokenPaths(`/invite/${TOKEN}`)).toBe("/invite/[token]");
  });

  it("redacts inside an absolute URL, which is what $current_url is", () => {
    expect(redactTokenPaths(`https://loonext.com/photos/${TOKEN}`)).toBe(
      "https://loonext.com/photos/[token]",
    );
  });

  it("survives the whole scrubUrl pipeline, query string and all", () => {
    // This is the exact value PostHog was sent on every view of a shared link.
    expect(scrubUrl(`https://loonext.com/photos/${TOKEN}?utm_source=sms`)).toBe(
      "https://loonext.com/photos/[token]?utm_source=sms",
    );
  });

  it("leaves the prefix alone when there is no token after it", () => {
    expect(redactTokenPaths("/photos")).toBe("/photos");
    expect(redactTokenPaths("/photos/")).toBe("/photos/");
  });

  it("does not eat a path that merely contains the word", () => {
    expect(redactTokenPaths("/inbox/job-photos-guide")).toBe(
      "/inbox/job-photos-guide",
    );
  });

  it("keeps anything after the token, redacting only the secret", () => {
    expect(redactTokenPaths(`/photos/${TOKEN}/download`)).toBe(
      "/photos/[token]/download",
    );
  });

  it("redacts a token that opens with a phone-shaped digit run", () => {
    // Why tokens are redacted BEFORE phones: the phone pattern would have eaten
    // the leading digits and left the rest of the secret, which is a partial
    // redaction that reads like a finished one.
    const digitFirst = `4165551234${TOKEN}`;
    expect(scrubUrl(`/photos/${digitFirst}`)).toBe("/photos/[token]");
  });

  it("reaches PostHog's properties, wherever they sit", () => {
    // $current_url and $pathname both go through scrubUnknown → scrubUrl.
    const scrubbed = scrubUnknown({
      $current_url: `https://loonext.com/photos/${TOKEN}`,
      $pathname: `/photos/${TOKEN}`,
    }) as Record<string, string>;
    expect(JSON.stringify(scrubbed)).not.toContain(TOKEN);
    expect(scrubbed.$pathname).toBe("/photos/[token]");
  });
});

describe("#558 the prefix list cannot go stale", () => {
  /**
   * Derived from the filesystem, because a hand-written list is exactly what
   * went wrong: `/photos/[token]` shipped and nobody added a rule for it. Three
   * more tokenised links are already queued behind the same primitive (quotes,
   * payment, calendar feed), so the next one has to fail here rather than in
   * a vendor's dashboard.
   */
  const APP_DIR = join(__dirname, "../../app");

  /** Every route whose URL contains a `[token]` segment, as URL path prefixes. */
  function tokenRoutePrefixes(dir: string, urlPath: string[] = []): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name === "[token]") {
        // The segment BEFORE [token] is what identifies the link type.
        const parent = urlPath[urlPath.length - 1];
        if (parent !== undefined) found.push(parent);
        continue;
      }
      // A route group — (app), (marketing) — is not part of the URL.
      const isGroup = name.startsWith("(") && name.endsWith(")");
      found.push(
        ...tokenRoutePrefixes(
          join(dir, name),
          isGroup ? urlPath : [...urlPath, name],
        ),
      );
    }
    return found;
  }

  it("finds the routes it is supposed to be checking", () => {
    // Loud rather than vacuous: a walk that found nothing would pass the next
    // test by default and read exactly like a clean bill of health.
    const found = tokenRoutePrefixes(APP_DIR);
    expect(found.length).toBeGreaterThan(0);
    expect(found).toContain("photos");
  });

  it("has a redaction rule for every [token] route on disk", () => {
    for (const prefix of tokenRoutePrefixes(APP_DIR)) {
      expect(
        TOKEN_PATH_PREFIXES as readonly string[],
        `app/**/${prefix}/[token] has no redaction rule, so its token would be sent to PostHog in full. Add "${prefix}" to TOKEN_PATH_PREFIXES in scrub.ts AND in apps/api/src/observability/scrub.ts.`,
      ).toContain(prefix);
    }
  });

  it("matches the Worker twin, which serves these paths too", () => {
    // The two scrubbers are documented as twins and the drift between them is
    // documented as "known" — a comment, which is why it drifted. The Worker
    // answers GET /photos/:token itself, so its list is not optional.
    const worker = readFileSync(
      join(__dirname, "../../../../api/src/observability/scrub.ts"),
      "utf8",
    );
    const declared = /TOKEN_PATH_PREFIXES = \[([^\]]*)\]/.exec(worker);
    expect(declared, "the Worker no longer declares TOKEN_PATH_PREFIXES").not
      .toBeNull();
    const workerPrefixes = (declared?.[1] ?? "")
      .split(",")
      .map((raw) => raw.trim().replace(/^"|"$/g, ""))
      .filter((raw) => raw !== "");
    expect(workerPrefixes).toEqual([...TOKEN_PATH_PREFIXES]);
    expect(TOKEN_REDACTED).toBe("[token]");
  });

  it("matches the Worker twin's URL and phone treatment, not just its token list", () => {
    /**
     * The assertion above compared ONE of the two things these files share, and
     * the other one drifted for a year underneath it.
     *
     * This file has stripped query strings from URL-carrying fields since 2026-07
     * because search-as-you-type round-trips typed names through `?q=`. The Worker
     * had no URL branch at all, so every outbound fetch it made breadcrumbed its
     * full URL — a customer's street address to the geocoder, a typed search term,
     * `email=in.(…)` on every send, and a presigned URL to a recorded voicemail.
     * The drift was written down as a comment in both files, which is exactly why
     * nobody acted on it: the token half had a test and stayed in step, the URL
     * half had prose and did not.
     *
     * So the pattern SOURCE is compared, not the behaviour: a behavioural test
     * passes if both sides are wrong in the same way, and these two files are
     * meant to be the same rule rather than merely to agree on the cases somebody
     * thought to write down.
     */
    const worker = readFileSync(
      join(__dirname, "../../../../api/src/observability/scrub.ts"),
      "utf8",
    );
    // Both sides read as SOURCE TEXT rather than one side imported: it keeps the
    // comparison symmetric, and it does not require exporting an internal from
    // either file just so a test can see it.
    const browser = readFileSync(join(__dirname, "./scrub.ts"), "utf8");
    for (const name of [
      "URL_KEY_PATTERN",
      "PHONE_PATTERN",
      "UUID_PATTERN",
      "EMAIL_PATTERN",
    ] as const) {
      const pattern = new RegExp(`${name} =\\s*(/.*/[a-z]*);`);
      const mine = pattern.exec(browser);
      const theirs = pattern.exec(worker);
      expect(mine, `this file no longer declares ${name}`).not.toBeNull();
      expect(theirs, `the Worker no longer declares ${name}`).not.toBeNull();
      expect(
        theirs?.[1],
        `${name} has drifted between the browser scrubber and the Worker twin. ` +
          `They are one rule written twice; whichever moved is the bug.`,
      ).toBe(mine?.[1]);
    }
  });
});
