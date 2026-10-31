/**
 * What may go into a public GitHub issue. The repository is public, so an
 * issue body is published the moment it is written: phone numbers outside the
 * fictional 555-0100..0199 range become `[number]`, and an `@name` would
 * notify a real account, so it is broken with a zero-width space.
 */

const MAX_BODY = 60_000;
const E164 = /(?<![0-9A-Za-z])(?:\+|%2[Bb])([1-9]\d{7,14})(?![0-9A-Za-z])/g;
const WRITTEN = /(?<![\d+])\(?([2-9]\d{2})(?:\)\s?|[-. ])([2-9]\d{2})[-. ](\d{4})(?!\d)/g;

function fictional(national: string): boolean {
  return national.length === 10 && national.slice(3, 6) === "555" && national.slice(6, 8) === "01";
}

export function redactForIssue(text: string): string {
  let out = text.replace(E164, (match, digits: string) =>
    digits.startsWith("1") && fictional(digits.slice(1)) ? match : "[number]",
  );
  out = out.replace(WRITTEN, (match, a: string, b: string, c: string) => (fictional(a + b + c) ? match : "[number]"));
  out = out.replace(/(^|[^\w`])@(?=[A-Za-z0-9])/g, (_match, before: string) => `${before}@\u200b`);
  return out.length > MAX_BODY ? `${out.slice(0, MAX_BODY)}\n\n(truncated)` : out;
}
