/**
 * #228 — the shape a translation must have.
 *
 * Mapped rather than `typeof EN`, so a translation is not required to repeat
 * the English literal type: `"Cancel"` is the English VALUE, not the contract.
 * What is the contract is the key set, and it is total — a key added to English
 * and forgotten in French fails `tsc` in the file that forgot it.
 */
export type Translated<T> = { [K in keyof T]: string };
