/**
 * The numbered clauses of the data processing agreement, parsed out of
 * `docs/DPA.md` (English) or `docs/DPA.fr.md` (French).
 *
 * One parser for both, so the two languages cannot be read by two different
 * rules and a clause count can be compared between them.
 */

export interface Clause {
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
export function parseDpaClauses(source: string): Clause[] {
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
    // A markdown rule is not a clause paragraph.
    if (line.trim() === "" || /^-{3,}$/.test(line.trim())) continue;
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
      "the data processing agreement parsed to zero clauses — refusing to publish an agreement " +
        "with no terms in it",
    );
  }
  return found;
}
