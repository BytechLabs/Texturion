import statement from "@root/docs/ACCESSIBILITY.md";
import type { Metadata } from "next";

import {
  LegalLink,
  LegalPage,
  LegalSectionBlock,
} from "@/components/marketing/legal/legal-page";
import { SUPPORT_EMAIL } from "@/lib/marketing/business";
import { buildMetadata } from "@/lib/marketing/seo";

/**
 * #238 / #285 — the accessibility conformance statement, published.
 *
 * `docs/ACCESSIBILITY.md` has been buyer-ready for a while and was reachable
 * only by someone with a clone. #238's acceptance says the statement is
 * PUBLISHED, and #285 is a buyer asking for exactly this; a markdown file in a
 * repository answers neither.
 *
 * # Why the table is read from the document rather than retyped
 *
 * The whole worth of that document is that every "verified" row names a test,
 * and `accessibility-statement.test.ts` fails if a named test disappears. A
 * hand-copied table on a marketing page would be a second copy of a claim
 * about our own product, drifting silently — the exact failure the document
 * was written to prevent, reintroduced by publishing it.
 *
 * So the rows are parsed out of the markdown at build time. There is one
 * source. If a row is added, removed or reworded, this page changes with it,
 * and if the parse ever finds nothing the build fails rather than shipping an
 * empty promise.
 *
 * Node APIs are fine here: this page is statically rendered at build time, in
 * the same process that already reads the blog registry.
 *
 * *Applying: the Zen of Clarity — the page carries the four questions a buyer
 * actually asks and the evidence column, and sends the reader to the source
 * for the rest rather than reprinting a document at them.*
 */

const PATH = "/legal/accessibility";

/** Kept in step with the document's own header, which states the same date. */
const LAST_UPDATED = "August 14, 2026";
const LAST_UPDATED_ISO = "2026-08-14";

export const metadata: Metadata = buildMetadata({
  title: "Accessibility conformance statement",
  description:
    "What Loonext verifies about accessibility and what it does not: WCAG 2.2 AA criteria enforced by named tests, the gaps stated plainly, and no third-party audit claimed.",
  path: PATH,
});

const sections = [
  { id: "asking", number: "1", heading: "What a buyer is usually asking" },
  { id: "verified", number: "2", heading: "Verified by a test" },
  { id: "not-verified", number: "3", heading: "Not verified" },
  { id: "gaps", number: "4", heading: "Known gaps" },
  { id: "contact", number: "5", heading: "Contact" },
];

interface VerifiedRow {
  criterion: string;
  holds: string;
  enforcedBy: string;
}

/**
 * The "Verified mechanically" table, parsed out of the statement.
 *
 * Deliberately strict: it takes the rows between that heading and the next
 * one, and throws if there are none. A silent empty table would publish "we
 * verify nothing" as confidently as the real thing.
 */
function verifiedRows(): VerifiedRow[] {
  const source = statement;
  const start = source.indexOf("## Verified mechanically");
  if (start === -1) {
    throw new Error(
      "docs/ACCESSIBILITY.md has no 'Verified mechanically' section — the " +
        "published statement cannot be built from it",
    );
  }
  const rest = source.slice(start);
  const end = rest.indexOf("\n## ", 1);
  const block = end === -1 ? rest : rest.slice(0, end);

  const rows: VerifiedRow[] = [];
  for (const line of block.split("\n")) {
    const cells = line.trim();
    // A table row, not the header and not the `|---|` divider.
    if (!cells.startsWith("|") || cells.includes("---")) continue;
    const parts = cells.split("|").slice(1, -1).map((cell) => cell.trim());
    if (parts.length !== 3) continue;
    if (parts[0] === "Criterion") continue;
    rows.push({ criterion: parts[0], holds: parts[1], enforcedBy: parts[2] });
  }
  if (rows.length === 0) {
    throw new Error(
      "docs/ACCESSIBILITY.md's verified table parsed to zero rows — refusing " +
        "to publish a statement that claims nothing is checked",
    );
  }
  return rows;
}

/** `**1.4.3** Contrast` → the bold part and the rest, without a markdown lib. */
function splitBold(text: string): { lead: string; rest: string } {
  const match = /^\*\*(.+?)\*\*\s*(.*)$/.exec(text);
  return match
    ? { lead: match[1], rest: match[2] }
    : { lead: "", rest: text };
}

/** Strips the `**` and backticks the markdown uses inside a cell. */
function plain(text: string): string {
  return text.replace(/\*\*/g, "").replace(/`/g, "");
}

export default function AccessibilityStatementPage() {
  const rows = verifiedRows();

  return (
    <LegalPage
      title="Accessibility conformance statement"
      summary={
        "We target WCAG 2.2 Level AA. Everything on this page is either enforced " +
        "by a named test that fails our build, or listed as not verified — there " +
        "is no third category, and nothing is claimed here because it is probably " +
        "true. No third-party audit has been carried out, which is exactly why " +
        "each claim names the check behind it."
      }
      lastUpdated={LAST_UPDATED}
      lastUpdatedIso={LAST_UPDATED_ISO}
      breadcrumbLabel="Accessibility"
      path={PATH}
      sections={sections}
    >
      <LegalSectionBlock id="asking" number="1" heading="What a buyer is usually asking">
        <p>
          &ldquo;Is it accessible?&rdquo; is four questions, and answering them
          separately is more useful than a single letter grade:
        </p>
        <ol>
          <li>Can somebody who cannot see the screen use it? — screen reader support.</li>
          <li>Can somebody who cannot use a mouse use it? — keyboard and pointer.</li>
          <li>
            Can somebody who cannot see it <em>well</em> use it? — contrast, text
            size, motion.
          </li>
          <li>Can you prove any of it? — the column that is usually empty.</li>
        </ol>
        <p>
          The table below is our answer to the fourth. It applies to the Loonext
          web application, and to the Android and iOS apps where stated.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="verified" number="2" heading="Verified by a test">
        <p>
          Each row fails a build if it stops being true. This is the whole table;
          there is nothing we count as verified that is not here. Every one of
          these has been proven by breaking it — the rule removed from the
          product, the check observed to fail, the removal reverted. A check that
          has only ever passed is not evidence.
        </p>
        {/* Wide content scrolls in its own container rather than pushing the
            page sideways on a phone, and `tabIndex={0}` is load-bearing rather
            than decoration: a scroll region that keyboard focus cannot enter
            is content a keyboard user cannot read. Same idiom as the
            comparison ledger, including the decision NOT to label the region —
            the `<caption>` is the accessible name, and a `role="region"` with
            its own label would announce the table twice. */}
        <div className="overflow-x-auto" tabIndex={0}>
          <table className="w-full min-w-[40rem] border-collapse text-left">
            <caption className="sr-only">
              WCAG 2.2 criteria Loonext enforces with a named automated check
            </caption>
            <thead>
              <tr>
                <th scope="col">Criterion</th>
                <th scope="col">What holds</th>
                <th scope="col">Enforced by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const { lead, rest } = splitBold(row.criterion);
                return (
                  <tr key={`${row.criterion}-${row.enforcedBy}`}>
                    <th scope="row">
                      {lead ? <strong>{lead}</strong> : null} {plain(rest)}
                    </th>
                    <td>{plain(row.holds)}</td>
                    <td>
                      <code>{plain(row.enforcedBy)}</code>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </LegalSectionBlock>

      <LegalSectionBlock id="not-verified" number="3" heading="Not verified">
        <p>
          <strong>No TalkBack or VoiceOver pass has been performed</strong>, on
          any flow, on either phone app. Every icon-only control has an
          accessible name and a build fails if one loses it — but a name is
          necessary and nowhere near sufficient. Reading order, whether a live
          region speaks at the right moment, whether a custom control exposes the
          right role and state, and whether a whole task can be driven by a
          screen reader all need a person with a phone. None of that is claimed
          here.
        </p>
        <p>
          <strong>Text scaling</strong> is enforced as a mechanism on both phones:
          every font is declared in a unit that carries the reader&rsquo;s font
          scale. Android&rsquo;s layout at 200% text is rendered on every test
          run; iOS has no equivalent render, so its matching fix rests on the two
          apps having had identical measurements rather than on a second picture.
        </p>
      </LegalSectionBlock>

      <LegalSectionBlock id="gaps" number="4" heading="Known gaps">
        <p>
          Stated plainly, because a buyer who finds one of these themselves stops
          believing the rest of the page.
        </p>
        <ul>
          <li>
            The thread panel&rsquo;s resize handle offers arrow-key resizing and a
            double-click reset. The double-click is the single-pointer path but
            reaches only one width; an arbitrary width without dragging is
            keyboard-only.
          </li>
          <li>
            <strong>No third-party audit</strong> has been carried out. Everything
            here is first-party, which is why each claim names the check behind
            it.
          </li>
          <li>Native screen-reader flows are untested end to end, as above.</li>
          <li>iOS is not rendered at 200% text anywhere.</li>
        </ul>
      </LegalSectionBlock>

      <LegalSectionBlock id="contact" number="5" heading="Contact">
        <p>
          If something here blocks you, or you need this statement in another
          format, write to{" "}
          <LegalLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</LegalLink>{" "}
          and say what you were trying to do. An accessibility problem that stops
          somebody working is treated as a broken feature, not as feedback.
        </p>
      </LegalSectionBlock>
    </LegalPage>
  );
}
