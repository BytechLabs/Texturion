import { readFileSync } from "node:fs";

/**
 * #291 — one way the client-parity tests read a source file.
 *
 * Three of them assert that a sentence or a rule appears in each client's
 * source, and every one of those assertions has to ignore COMMENTS: the prose
 * explaining why "Not asked" is a third state contains the words "Not asked",
 * so a client that collapsed the state and left the comment in place would
 * pass. Each test had its own copy of the stripper, and the copies were wrong
 * in the same way.
 *
 * WHAT WAS WRONG. `source.replace(/\/\*[\s\S]*?\*\//g, "")` swallows from the
 * first `/*` it finds to the next `*​/` — and `ContactsTab.kt` contains
 * `arrayOf("text/*", …)`, a MIME type in a string literal. Everything from
 * there to the next doc comment vanished, taking four hundred lines of real
 * code with it, and the assertion reading that file quietly checked nothing.
 *
 * That is the failure this whole family of tests exists to prevent, committed
 * by the tests themselves. It surfaced only because one assertion was moved
 * onto a file where the removed region mattered — the other two had been
 * passing over a hole for as long as they existed.
 *
 * WHAT THIS DOES INSTEAD. A block comment is only stripped when its `/*`
 * OPENS A LINE (optionally indented), which is how every doc block in this
 * repo is written and how no string literal ever is. Line comments are
 * stripped only when `//` follows whitespace or a line start, so a `https://`
 * inside a string survives too.
 */
export function parityCode(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, "")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}
