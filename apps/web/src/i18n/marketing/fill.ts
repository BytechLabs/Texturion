/**
 * Fill `{named}` holes in a catalogue string.
 *
 * The price answers carry up to five figures inside one sentence, and the
 * figures are computed (the first month is a SUM). Fragments would have fixed
 * them in English word order, which is exactly the thing a translation has to
 * be free to change.
 *
 * Its own module so client code can fill a string without importing
 * `home.ts`, the whole home page in both languages.
 */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key) =>
    key in values ? values[key] : whole,
  );
}
