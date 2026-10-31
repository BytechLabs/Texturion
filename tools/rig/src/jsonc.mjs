/**
 * Parses the JSONC that wrangler accepts: JSON plus line and block comments
 * and trailing commas. Strings are copied whole, so a `//` or a `,]` inside a
 * URL or a description is left alone.
 */
export function parseJsonc(text) {
  let out = "";
  // A comma is held back until the next significant character shows whether
  // it trails the last element.
  let pendingComma = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (text.startsWith("//", i)) {
      while (i < n && text[i] !== "\n") i += 1;
    } else if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
    } else if (/\s/.test(ch)) {
      out += ch;
      i += 1;
    } else if (ch === ",") {
      if (pendingComma) out += ",";
      pendingComma = true;
      i += 1;
    } else {
      if (pendingComma && ch !== "}" && ch !== "]") out += ",";
      pendingComma = false;
      if (ch === '"') {
        let j = i + 1;
        while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
        out += text.slice(i, j + 1);
        i = j + 1;
      } else {
        out += ch;
        i += 1;
      }
    }
  }
  if (pendingComma) out += ",";
  return JSON.parse(out);
}
