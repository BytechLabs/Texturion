import { Fragment, type ReactNode } from "react";

/**
 * The deliberately small rich-text grammar used by translated legal copy.
 *
 * Keeping the whole sentence in the catalogue lets French move a link or an
 * emphasized phrase to where French grammar needs it. The renderer recognizes
 * only the marks these pages use: `**strong**`, `*emphasis*`, `` `code` ``, and
 * named `{slots}` supplied by the page body. Unknown slots fail loudly instead
 * of leaking braces into a published legal document.
 */
export function LegalRichText({
  text,
  slots = {},
}: {
  text: string;
  slots?: Record<string, ReactNode>;
}) {
  const tokens = text.split(
    /(\{[A-Za-z][A-Za-z0-9]*\}|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g,
  );

  return tokens.map((token, index) => {
    const slot = /^\{([A-Za-z][A-Za-z0-9]*)\}$/.exec(token);
    if (slot) {
      const name = slot[1];
      if (!(name in slots)) {
        throw new Error(`Missing legal-copy slot: ${name}`);
      }
      return <Fragment key={`${name}-${index}`}>{slots[name]}</Fragment>;
    }
    if (token.startsWith("**") && token.endsWith("**")) {
      return <strong key={index}>{token.slice(2, -2)}</strong>;
    }
    if (token.startsWith("*") && token.endsWith("*")) {
      return <em key={index}>{token.slice(1, -1)}</em>;
    }
    if (token.startsWith("`") && token.endsWith("`")) {
      return <code key={index}>{token.slice(1, -1)}</code>;
    }
    return <Fragment key={index}>{token}</Fragment>;
  });
}
