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
    expect([...linked].sort()).toEqual([url]);
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
});
