import { Fragment, isValidElement, type ReactNode } from "react";

const MARKS = /(\{[A-Za-z][A-Za-z0-9]*\}|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/;
const SLOTS_ONLY = /(\{[A-Za-z][A-Za-z0-9]*\})/;
const SLOT_PATTERN = /\{([A-Za-z][A-Za-z0-9]*)\}/;

/**
 * The deliberately small rich-text grammar used by translated legal copy.
 *
 * Keeping the whole sentence in the catalogue lets French move a link or an
 * emphasized phrase to where French grammar needs it. The renderer recognizes
 * only the marks these pages use: `**strong**`, `*emphasis*`, `` `code` ``, and
 * named `{slots}` supplied by the page body, inside a mark as well as outside.
 * Unknown slots fail loudly instead of leaking braces into a published legal
 * document.
 */
export function LegalRichText({
  text,
  slots = {},
}: {
  text: string;
  slots?: Record<string, ReactNode>;
}) {
  const rendered = renderMarks(text, MARKS, slots);
  const leftover = leftoverSlot(rendered);
  if (leftover) {
    throw new Error(`Unfilled legal-copy slot: ${leftover}`);
  }
  return rendered;
}

/** `split` with one capture group puts the matched marks at the odd indexes. */
function renderMarks(
  text: string,
  grammar: RegExp,
  slots: Record<string, ReactNode>,
): ReactNode[] {
  return text.split(grammar).map((token, index) => {
    if (index % 2 === 0) return token;
    if (token.startsWith("{")) {
      const name = token.slice(1, -1);
      if (!Object.hasOwn(slots, name)) {
        throw new Error(`Missing legal-copy slot: ${name}`);
      }
      return <Fragment key={index}>{slots[name]}</Fragment>;
    }
    if (token.startsWith("**")) {
      return <strong key={index}>{renderMarks(token.slice(2, -2), MARKS, slots)}</strong>;
    }
    if (token.startsWith("`")) {
      return <code key={index}>{renderMarks(token.slice(1, -1), SLOTS_ONLY, slots)}</code>;
    }
    return <em key={index}>{renderMarks(token.slice(1, -1), MARKS, slots)}</em>;
  });
}

/** The first `{name}` left in the rendered text, including text a slot value brought in. */
function leftoverSlot(node: ReactNode): string | undefined {
  if (typeof node === "string") return SLOT_PATTERN.exec(node)?.[1];
  if (Array.isArray(node)) {
    for (const child of node) {
      const name = leftoverSlot(child);
      if (name) return name;
    }
    return undefined;
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return leftoverSlot(node.props.children);
  }
  return undefined;
}
