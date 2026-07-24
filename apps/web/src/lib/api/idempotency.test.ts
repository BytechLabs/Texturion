import { describe, expect, it } from "vitest";

import {
  attachmentSignature,
  idempotencyKeyFor,
  type FailedAttempt,
} from "./idempotency";

/** Deterministic mint so the assertions are about the RULE, not randomness. */
function minter() {
  let n = 0;
  return () => `minted-${++n}`;
}

describe("idempotencyKeyFor", () => {
  it("mints a fresh key for a first attempt", () => {
    expect(idempotencyKeyFor(null, "sig-a", minter())).toBe("minted-1");
  });

  it("REUSES the key when retrying identical content", () => {
    // The money case: the first send's response was lost, the draft came back,
    // the user pressed send again. The server must see the same key and dedupe,
    // or the customer gets the text twice and is billed twice.
    const previous: FailedAttempt = { signature: "sig-a", key: "key-from-attempt-1" };
    expect(idempotencyKeyFor(previous, "sig-a", minter())).toBe("key-from-attempt-1");
  });

  it("mints a new key once the content changes", () => {
    // An edited message is a genuinely new message — reusing the key would make
    // the server swallow it as a duplicate and the customer would never get it.
    const previous: FailedAttempt = { signature: "sig-a", key: "key-from-attempt-1" };
    expect(idempotencyKeyFor(previous, "sig-b", minter())).toBe("minted-1");
  });

  it("mints a new key after a success clears the record", () => {
    expect(idempotencyKeyFor(null, "sig-a", minter())).toBe("minted-1");
  });
});

describe("attachmentSignature", () => {
  const file = (name: string, size: number) => ({ file: { name, size } });

  it("is stable for the same files", () => {
    const a = [file("photo.jpg", 100), file("plan.pdf", 200)];
    expect(attachmentSignature(a)).toBe(attachmentSignature([...a]));
  });

  it("changes when a file is swapped, added, or resized", () => {
    const base = attachmentSignature([file("photo.jpg", 100)]);
    expect(attachmentSignature([file("other.jpg", 100)])).not.toBe(base);
    expect(attachmentSignature([file("photo.jpg", 101)])).not.toBe(base);
    expect(
      attachmentSignature([file("photo.jpg", 100), file("extra.png", 5)]),
    ).not.toBe(base);
  });

  it("is empty with no attachments, so a text-only retry still matches", () => {
    expect(attachmentSignature([])).toBe("");
  });
});
