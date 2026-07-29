/**
 * #335 / D75 — the shared public-link primitive.
 *
 * Everything here is a security property, because the person exposed by a
 * mistake is not our user and never agreed to anything with us. The tests
 * that earn their place are the ones that would still pass if the code were
 * subtly wrong in the ways that matter: a token that is stored, a purpose that
 * is not checked, a failure that tells the holder which failure it was.
 */
import { describe, expect, it, vi } from "vitest";

import {
  generateToken,
  hashToken,
  mintPublicLink,
  resolvePublicLink,
} from "./tokens";

/** A db stub that records the RPC calls it received. */
function stub(data: unknown, fail = false) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    return fail ? { data: null, error: { message: "boom" } } : { data, error: null };
  });
  return { db: { rpc } as never, calls, rpc };
}

describe("generateToken", () => {
  it("is 256 bits, URL-safe, and not a UUID", () => {
    const token = generateToken();
    // 32 bytes base64url with padding stripped.
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // A v4 UUID is 122 bits and a recognisable shape. These URLs sit in SMS
    // logs, browser history and third-party calendar servers; guessing has to
    // be hopeless, not merely hard.
    expect(token).not.toMatch(/^[0-9a-f-]{36}$/);
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateToken()));
    expect(seen.size).toBe(500);
  });
});

describe("hashToken", () => {
  it("is a stable sha-256 hex digest", async () => {
    const a = await hashToken("hello");
    expect(a).toHaveLength(64);
    expect(a).toMatch(/^[0-9a-f]+$/);
    expect(await hashToken("hello")).toBe(a);
    expect(await hashToken("hellp")).not.toBe(a);
  });
});

describe("mintPublicLink", () => {
  it("sends the HASH and never the token", async () => {
    // THE property. A leaked backup, a log line or a support screenshot must
    // disclose nothing usable — password-digest reasoning applied to a URL.
    const { db, calls } = stub("link-1");
    const result = await mintPublicLink(db, {
      companyId: "c1",
      purpose: "quote_view",
      subjectType: "quote",
      subjectId: "q1",
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const sent = calls[0].args;
    expect(sent.p_token_hash).toBe(await hashToken(result.token));
    // The plaintext must appear nowhere in what crossed the boundary.
    expect(JSON.stringify(sent)).not.toContain(result.token);
  });

  it("returns the plaintext exactly once, to the caller", async () => {
    const { db } = stub("link-1");
    const result = await mintPublicLink(db, {
      companyId: "c1",
      purpose: "payment",
      subjectType: "invoice",
      subjectId: "i1",
      expiresAt: new Date(Date.now() + 3_600_000),
      maxUses: 1,
    });
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.id).toBe("link-1");
  });

  it("carries single-use through, for a payment link that must die on payment", async () => {
    const { db, calls } = stub("link-1");
    await mintPublicLink(db, {
      companyId: "c1",
      purpose: "payment",
      subjectType: "invoice",
      subjectId: "i1",
      expiresAt: new Date(Date.now() + 3_600_000),
      maxUses: 1,
    });
    expect(calls[0].args.p_max_uses).toBe(1);
  });
});

describe("resolvePublicLink", () => {
  it("passes the purpose, so a view token cannot be replayed against accept", async () => {
    const { db, calls } = stub({ ok: true, outcome: "ok" });
    await resolvePublicLink(db, generateToken(), "quote_accept");
    expect(calls[0].args.p_purpose).toBe("quote_accept");
  });

  it("never sends the token itself to the database", async () => {
    const { db, calls } = stub({ ok: true, outcome: "ok" });
    const token = generateToken();
    await resolvePublicLink(db, token, "quote_view");
    expect(JSON.stringify(calls[0].args)).not.toContain(token);
  });

  it("rejects a wrong-shaped token without touching the database", async () => {
    // Hashing attacker-controlled input to run a query is free work whose
    // volume the attacker chooses.
    const { db, rpc } = stub({ ok: true, outcome: "ok" });
    for (const bad of ["", "short", "x".repeat(200), "has spaces in it", "../../etc/passwd"]) {
      expect((await resolvePublicLink(db, bad, "quote_view")).ok, bad).toBe(false);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails CLOSED when the database is unreachable", async () => {
    // The opposite posture to most reads in this codebase. Everywhere else an
    // unreachable database should degrade politely; here it must never hand
    // out access it could not verify.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = stub(null, true);

    const result = await resolvePublicLink(db, generateToken(), "quote_view");

    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("not_found");
    errorSpy.mockRestore();
  });

  it("returns the subject only on success", async () => {
    const { db } = stub({
      ok: true,
      outcome: "ok",
      link_id: "l1",
      company_id: "c1",
      subject_type: "quote",
      subject_id: "q1",
    });
    const result = await resolvePublicLink(db, generateToken(), "quote_view");
    expect(result.subject_id).toBe("q1");
  });

  it("passes the country for enumeration patterns, never an address", async () => {
    const { db, calls } = stub({ ok: true, outcome: "ok" });
    await resolvePublicLink(db, generateToken(), "quote_view", "CA");
    expect(calls[0].args.p_country).toBe("CA");
    // A country is enough to see a pattern. Storing the address would be
    // collecting data about a third party in order to protect them.
    expect(Object.keys(calls[0].args)).not.toContain("p_ip");
  });
});
