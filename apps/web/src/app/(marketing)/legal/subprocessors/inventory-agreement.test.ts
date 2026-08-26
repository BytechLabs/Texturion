import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * #438 ask 2 — the two documents that describe our third parties must move
 * together.
 *
 * `docs/DATA-INVENTORY.md` and the public subprocessors page state the same facts
 * to different audiences: one is what the Apple and Google store declarations are
 * built from, the other is what a customer's privacy reviewer reads. They have
 * already diverged once, and the way they diverged is the thing to design against.
 *
 * #389: when Workers AI shipped, `DATA-INVENTORY.md` was updated and the public
 * page was not — so the page still said Cloudflare received *"no message content"*
 * while Workers AI was receiving message threads and voicemail audio. Nobody was
 * careless. There was simply nothing that fired when one moved and the other did
 * not.
 *
 * THIS IS THAT THING. It is deliberately not a checklist line: a checklist is
 * remembered, a test is not optional. #438's own devil's advocate makes the point —
 * a process step that adds friction to every release gets skipped and becomes
 * theatre. A test costs nothing until it is right to fail.
 *
 * WHAT IT CANNOT DO, said plainly: it checks that both documents NAME the same
 * third parties and that the Workers AI disclosure appears on both. It cannot read
 * the prose and judge whether each description is accurate — that is a human
 * reading, and `docs/DESCRIPTIVE-SURFACES.md` is where the rule for it lives. What
 * this catches is the specific mechanical failure that has actually happened: a
 * vendor, or the AI disclosure, present on one surface and absent from the other.
 */

const REPO = join(process.cwd(), "..", "..");
const INVENTORY = readFileSync(join(REPO, "docs", "DATA-INVENTORY.md"), "utf8");
const SUBPROCESSORS_BODY = readFileSync(
  join(
    process.cwd(),
    "src",
    "components",
    "marketing",
    "legal",
    "subprocessors-page.tsx",
  ),
  "utf8",
);
const SUBPROCESSORS_COPY = readFileSync(
  join(
    process.cwd(),
    "src",
    "i18n",
    "marketing",
    "legal-subprocessors.ts",
  ),
  "utf8",
);
const SUBPROCESSORS = SUBPROCESSORS_BODY + SUBPROCESSORS_COPY;

/**
 * Every third party, with the token each surface spells it with.
 *
 * The two spellings differ legitimately ("Supabase (on AWS)" vs
 * "Supabase / AWS us-east-1"), so the roster names the pairing rather than
 * pretending the strings match. Declaring it here is the point: a NEW vendor added
 * to one document and not the other fails the count assertion below, and a vendor
 * added to neither fails nothing — which is correct, because it does not exist.
 */
const VENDORS: { token: string; why: string }[] = [
  { token: "Telnyx", why: "the carrier: numbers, message content, call audio" },
  { token: "Supabase", why: "database, auth, file storage" },
  { token: "Cloudflare", why: "hosting, the Worker runtime, and Workers AI" },
  { token: "Stripe", why: "payments" },
  { token: "Resend", why: "transactional email" },
  { token: "Firebase Cloud Messaging", why: "push to Android" },
  { token: "Sentry", why: "error monitoring" },
  { token: "PostHog", why: "product analytics, web only" },
];

/** Rows in the inventory's third-party table, counted from its `| **Name**` shape. */
function inventoryVendorCount(): number {
  /*
   * SCOPED TO THE SUB-PROCESSOR SECTION, not the whole file.
   *
   * This counted every bolded table row in DATA-INVENTORY.md, which was exact
   * while that table was the only one. #243 added a second — the paths a
   * WORKSPACE opens, which are deliberately not sub-processors and must not be
   * on the roster — and two rows in it read as two unknown vendors.
   *
   * The proxy was the bug: "a bold row anywhere" was never what this guard
   * meant. It means the rows under the heading that introduces the vendors.
   */
  const section = INVENTORY.split("## Who else sees it")[1] ?? "";
  const table = section.split(/^## /m)[0] ?? "";
  return (table.match(/^\| \*\*[^*]+\*\*/gm) ?? []).length;
}

/** Entries in the subprocessors page's array, counted from its `name:` keys. */
function pageVendorCount(): number {
  return (SUBPROCESSORS.match(/^\s+name: "/gm) ?? []).length;
}

describe("#438 — DATA-INVENTORY.md and the subprocessors page name the same third parties", () => {
  it("lists every rostered vendor on both surfaces", () => {
    const missing: string[] = [];
    for (const { token } of VENDORS) {
      if (!INVENTORY.includes(token)) missing.push(`DATA-INVENTORY.md: ${token}`);
      if (!SUBPROCESSORS.includes(token)) {
        missing.push(`subprocessors page: ${token}`);
      }
    }
    expect(
      missing,
      `\n\nA third party is named on one surface and not the other:\n  ` +
        `${missing.join("\n  ")}\n\n` +
        `These two documents describe the same facts to different audiences (store\n` +
        `declarations vs a customer's privacy reviewer). #389 happened because one\n` +
        `moved and the other did not.\n`,
    ).toEqual([]);
  });

  it("has no vendor on either surface that the roster does not know about", () => {
    // The assertion that makes this a binding rather than a spot-check: adding a
    // ninth vendor to one document without the other fails here, because the
    // counts stop agreeing with the roster.
    expect(
      inventoryVendorCount(),
      "DATA-INVENTORY.md's third-party table has a row the roster above does not " +
        "list. Add it to VENDORS and to the subprocessors page.",
    ).toBe(VENDORS.length);
    expect(
      pageVendorCount(),
      "The subprocessors page has an entry the roster above does not list. Add it " +
        "to VENDORS and to DATA-INVENTORY.md.",
    ).toBe(VENDORS.length);
  });

  it("discloses Workers AI on BOTH surfaces, which is the #389 divergence itself", () => {
    // The exact failure: the inventory named Workers AI and the public page still
    // said Cloudflare received no message content. Either both disclose it or the
    // feature has been removed and both should stop.
    expect(INVENTORY).toMatch(/Workers AI/);
    expect(SUBPROCESSORS).toMatch(/Workers AI/);
  });

  it("neither surface claims Cloudflare receives no message content", () => {
    // The literal sentence #389 found. It was true before Workers AI shipped, which
    // is what made it easy to leave in place.
    for (const [label, source] of [
      ["DATA-INVENTORY.md", INVENTORY],
      ["the subprocessors page", SUBPROCESSORS],
    ] as const) {
      expect(
        source,
        `${label} still claims Cloudflare sees no message content. Workers AI ` +
          `receives message threads (suggested replies), message text (task ` +
          `details) and voicemail audio (transcripts).`,
      ).not.toMatch(/Cloudflare[^.]*no message content/i);
    }
  });
});
