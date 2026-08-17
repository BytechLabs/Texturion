import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Metadata } from "next";

import {
  LegalLink,
  LegalPage,
  LegalSectionBlock,
} from "@/components/marketing/legal/legal-page";
import { SUPPORT_EMAIL } from "@/lib/marketing/business";
import { buildMetadata } from "@/lib/marketing/seo";

/**
 * #285 — the data processing agreement, published.
 *
 * A buyer with a compliance function asks for this by name, and its absence
 * stalls a deal regardless of how good the security page is. It is the one
 * item on that issue that is a CONTRACT rather than a description of
 * something already true.
 *
 * # Read from the document, not retyped
 *
 * `docs/DPA.md` is the source. Every factual clause there cites where the fact
 * lives, and `dpa-promises.test.ts` holds the three clauses it deliberately
 * under-promises on. A hand-copied contract on a marketing page would be a
 * second version of a legal commitment drifting from the first — which for a
 * contract is worse than for anything else on this site, because the drift is
 * enforceable.
 *
 * So the sections are parsed out of the markdown at build time. One source. If
 * the parse finds nothing the build fails rather than publishing an empty
 * agreement.
 *
 * *Applying: the Safety Principle — a legal page should look like every other
 * legal page here, because a buyer's eye is trained on that shape and a
 * cleverly designed contract reads as evasive.*
 */

const PATH = "/legal/dpa";
const LAST_UPDATED = "August 16, 2026";
const LAST_UPDATED_ISO = "2026-08-16";

export const metadata: Metadata = buildMetadata({
  title: "Data processing agreement",
  description:
    "The Loonext DPA: roles, sub-processors, breach notification within 72 hours, deletion, and the three things we do not promise because the product cannot deliver them.",
  path: PATH,
});

interface Clause {
  number: string;
  heading: string;
  /** Paragraphs and bullet lines, in order, already stripped of markdown. */
  blocks: { kind: "p" | "li"; text: string }[];
}

/** `**bold**` and `` `code` `` out; the page's own type carries the emphasis. */
function plain(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .trim();
}

/**
 * The numbered clauses, parsed out of the agreement.
 *
 * Deliberately strict: a parse that found nothing would publish a contract
 * with no terms in it, which is a worse failure than a build error.
 */
function clauses(): Clause[] {
  const source = readFileSync(
    join(process.cwd(), "..", "..", "docs", "DPA.md"),
    "utf8",
  );
  const found: Clause[] = [];
  let current: Clause | null = null;

  for (const raw of source.split("\n")) {
    const line = raw.trimEnd();
    const heading = /^##\s+(\d+)\.\s+(.+)$/.exec(line);
    if (heading) {
      if (current) found.push(current);
      current = { number: heading[1], heading: plain(heading[2]), blocks: [] };
      continue;
    }
    // A non-numbered heading ends the clause run: everything after the last
    // numbered section is process notes for us, not terms for a customer.
    if (/^##\s+/.test(line) && current) {
      found.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    if (line.startsWith(">")) continue; // source citations stay in the repo
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      current.blocks.push({ kind: "li", text: plain(bullet[1]) });
      continue;
    }
    if (line.trim() === "") continue;
    const previous = current.blocks[current.blocks.length - 1];
    // Markdown wraps mid-sentence; join a continuation onto the block it
    // belongs to rather than emitting a paragraph per line.
    if (previous && previous.kind === "p" && !line.startsWith("  ")) {
      previous.text = `${previous.text} ${plain(line)}`.trim();
      continue;
    }
    if (previous && previous.kind === "li" && line.startsWith("  ")) {
      previous.text = `${previous.text} ${plain(line)}`.trim();
      continue;
    }
    current.blocks.push({ kind: "p", text: plain(line) });
  }
  if (current) found.push(current);

  if (found.length === 0) {
    throw new Error(
      "docs/DPA.md parsed to zero clauses — refusing to publish an agreement " +
        "with no terms in it",
    );
  }
  return found;
}

export default function DpaPage() {
  const terms = clauses();

  return (
    <LegalPage
      title="Data processing agreement"
      summary={
        "We act as a processor for the customer content your workspace sends and " +
        "receives. This says what we do with it, who else touches it, what happens " +
        "when you delete it, and how quickly we tell you if something goes wrong. " +
        "It has not been reviewed by outside counsel, and it deliberately does not " +
        "promise a data residency guarantee, complete deletion, or an audit right, " +
        "because the product cannot deliver those and a contract that says " +
        "otherwise is worse than none."
      }
      lastUpdated={LAST_UPDATED}
      lastUpdatedIso={LAST_UPDATED_ISO}
      breadcrumbLabel="Data processing agreement"
      path={PATH}
      sections={terms.map((clause) => ({
        id: `clause-${clause.number}`,
        number: clause.number,
        heading: clause.heading,
      }))}
    >
      {terms.map((clause) => (
        <LegalSectionBlock
          key={clause.number}
          id={`clause-${clause.number}`}
          number={clause.number}
          heading={clause.heading}
        >
          {clause.blocks.map((block, index) =>
            block.kind === "li" ? null : <p key={index}>{block.text}</p>,
          )}
          {clause.blocks.some((block) => block.kind === "li") && (
            <ul>
              {clause.blocks
                .filter((block) => block.kind === "li")
                .map((block, index) => (
                  <li key={index}>{block.text}</li>
                ))}
            </ul>
          )}
        </LegalSectionBlock>
      ))}

      <LegalSectionBlock id="contact" number="12" heading="Contact">
        <p>
          Questions about this agreement, or a redline from your legal team, go
          to{" "}
          <LegalLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</LegalLink>
          . A buyer whose counsel wants to mark this up is welcome to; the facts
          in it are checkable and will survive the exercise.
        </p>
      </LegalSectionBlock>
    </LegalPage>
  );
}
