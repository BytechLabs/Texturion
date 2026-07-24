/**
 * One rule, shared by every surface that can retry a BILLABLE send.
 *
 * A failed send restores the draft, so the natural next action is to press send
 * again. If each attempt carries a fresh Idempotency-Key, a send whose response
 * was merely LOST — flaky signal, tab closed mid-request, Worker cold-start
 * timeout — reaches the customer a second time and bills a second time. The
 * server dedupes on the key, so retrying the SAME content must reuse it.
 *
 * Any edit mints a new key: a changed body or recipient is a genuinely new
 * message and must not be swallowed as a duplicate.
 *
 * (The Android composer has had this rule since #20; these helpers give web the
 * same behaviour and make it testable in one place instead of two components.)
 */

/** The last attempt that failed, and the key it used. */
export interface FailedAttempt {
  /** Everything that makes the message what it is — recipient, text, files. */
  signature: string;
  key: string;
}

/**
 * The key to send with. Reuses `previous.key` when `signature` is unchanged,
 * otherwise mints a fresh one.
 *
 * `mint` is injectable so tests are deterministic; production callers omit it.
 */
export function idempotencyKeyFor(
  previous: FailedAttempt | null,
  signature: string,
  mint: () => string = () => crypto.randomUUID(),
): string {
  return previous !== null && previous.signature === signature
    ? previous.key
    : mint();
}

/**
 * Stable signature for a set of staged files. Name+size is enough to notice a
 * swapped attachment without reading the bytes.
 */
export function attachmentSignature(
  files: readonly { file: { name: string; size: number } }[],
): string {
  return files.map((a) => `${a.file.name}:${a.file.size}`).join("|");
}
