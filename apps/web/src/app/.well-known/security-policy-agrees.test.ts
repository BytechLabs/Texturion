/**
 * #285 — the repo's SECURITY.md and the served security.txt name ONE address.
 *
 * `/.well-known/security.txt` is the machine-readable contact (RFC 9116) and
 * `SECURITY.md` is what GitHub shows a researcher looking at a public repo.
 * Two files carrying a contact address is two chances to be wrong, and the half
 * that goes stale is the half nobody re-reads.
 *
 * WHY THIS FILE EXISTS AT ALL. Without a `SECURITY.md`, GitHub's own
 * "Report a vulnerability" prompt sends somebody to the issue tracker — which
 * publishes the report to everyone, including whoever would use it, before
 * anybody here has read it. The file is the fix; this test is what stops it
 * quietly disagreeing with the route it points at.
 *
 * Read from the ROUTE rather than retyped, so the route stays the authority.
 * A test that spelled the address itself would be a third copy.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { GET } from "./security.txt/route";
import { LIVE_ROUTES } from "@/lib/marketing/site";

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
);

const policy = readFileSync(join(REPO_ROOT, "SECURITY.md"), "utf8");

/**
 * The prose with its line wrapping folded away.
 *
 * Markdown wraps at 80 columns, so "do not open a public issue" is split across
 * two lines in the file and matches no substring search — which is how the
 * first version of the assertion below failed against a document that says
 * exactly what it is supposed to say. The sentence is the contract; the wrap is
 * formatting.
 */
const prose = policy.replace(/\s+/g, " ");

/** The served file, parsed the way a researcher's tooling would read it. */
async function served(): Promise<Map<string, string>> {
  const body = await GET().text();
  const fields = new Map<string, string>();
  for (const line of body.split("\n")) {
    const at = line.indexOf(":");
    if (at === -1) continue;
    fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  return fields;
}

describe("#285 the security policy and security.txt agree", () => {
  /**
   * EVERY address in the file, not merely one of them.
   *
   * `toContain` was the first spelling and a mutation walked past it: the
   * markdown names the address twice (once as link text, once in the `mailto:`),
   * so changing ONE left the other matching and the test green — over a
   * document carrying two different contacts, which is the exact failure this
   * file's own prose calls worse than having one.
   *
   * Set equality in both directions. An address the route does not serve is a
   * researcher writing to nobody.
   */
  it("names the served contact and no other address", async () => {
    const contact = (await served()).get("Contact");
    expect(contact, "security.txt lost its Contact field").toBeTruthy();
    const address = contact!.replace(/^mailto:/, "");
    expect(address).toMatch(/@/);

    const named = new Set(policy.match(/[\w.+-]+@[\w.-]+\.\w+/g) ?? []);
    expect(named.size, "SECURITY.md names no address at all").toBeGreaterThan(0);
    expect([...named].sort()).toEqual([address]);
  });

  /** Same rule for the policy URL: every `/security` link is the served one. */
  it("sends a researcher to the policy page security.txt points at", async () => {
    const url = (await served()).get("Policy");
    expect(url, "security.txt lost its Policy field").toBeTruthy();

    const linked = new Set(
      (policy.match(/https:\/\/loonext\.com\/[\w./-]*/g) ?? []).filter(
        (href) => !href.includes("/.well-known/"),
      ),
    );
    expect(linked.size, "SECURITY.md links no policy page").toBeGreaterThan(0);

    // The Policy target must be one of them: a researcher who follows
    // `security.txt` and a researcher who reads the repository have to land on
    // the same commitment.
    expect([...linked]).toContain(url);

    // And every OTHER link it makes must be a route this site actually serves.
    //
    // This used to demand set equality against the single Policy URL, which was
    // right while the file linked one page and became a ceiling the moment it
    // needed two: #285 added the disclosure page the Policy field should point
    // at, and the old assertion could only be satisfied by deleting the link to
    // /security. The intent was never "exactly one link" — it was "no link that
    // sends somebody nowhere", so that is what is asserted.
    const liveUrls = new Set(
      Object.values(LIVE_ROUTES).map((path) => `https://loonext.com${path}`),
    );
    for (const href of linked) {
      expect(
        liveUrls,
        `SECURITY.md links ${href}, which is not a live route`,
      ).toContain(href.replace(/\/$/, ""));
    }
  });

  /**
   * The whole point of the file, asserted rather than assumed.
   *
   * If SECURITY.md ever stops saying this, GitHub's prompt is the loudest
   * instruction a researcher sees and it points at a public tracker.
   */
  it("tells a researcher not to open a public issue", () => {
    expect(prose.toLowerCase()).toContain("do not open a public issue");
  });

  /**
   * #285 item 5: an explicit "not yet" on certifications.
   *
   * Buyers routinely accept a clear no; what they cannot accept is discovering
   * the gap after assuming otherwise. This is also the sentence most likely to
   * be quietly deleted the week somebody wants a deal to move faster.
   */
  it("says plainly that there is no SOC 2 and no completed pen test", () => {
    expect(prose).toMatch(/SOC 2/);
    expect(prose).toMatch(/penetration test/i);
  });

  /**
   * #285 item 3, the half a contact address alone does not cover.
   *
   * "Email us" is a channel. A disclosure policy is a channel plus a promise
   * about what happens after, and the promise is what a procurement
   * questionnaire asks for by name — "what is your SLA for triaging a reported
   * vulnerability" is a question with a wrong answer of silence.
   *
   * Asserted as NUMBERS rather than as prose, because the failure worth
   * catching is somebody softening the commitment into "we aim to respond
   * promptly" during an edit, which reads fine and promises nothing.
   */
  it("commits to a timeline a reporter can hold us to", () => {
    expect(prose).toMatch(/within 3 business days/i);
    expect(prose).toMatch(/within 10 business days/i);
  });

  /**
   * Safe harbour, and the reason it is worth a test: the repository is public,
   * so researchers read this code whether or not we invite them. Somebody
   * deciding whether to send a report is reading for the catch, and a policy
   * that has quietly lost its authorisation clause is one that gets a public
   * disclosure instead of an email.
   */
  it("authorises good-faith research and says what it asks in return", () => {
    expect(prose.toLowerCase()).toContain("safe harbour");
    expect(prose).toMatch(/will not pursue legal action/i);
    // The conditions are the other half of the bargain. A safe harbour with no
    // stated limits is one we cannot actually honour.
    expect(prose).toMatch(/90 days/);
    expect(prose.toLowerCase()).toContain("workspace you control");
  });

  /**
   * The honest "no". A researcher who assumes there is money in this and
   * discovers otherwise after the work has been given a bad deal by omission.
   */
  it("says there is no paid bounty", () => {
    expect(prose.toLowerCase()).toContain("do not run a paid bounty");
  });
});
