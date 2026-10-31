import { describe, expect, it } from "vitest";

import { edgeSecrets } from "./edge-secrets.mjs";
import {
  bundleParts,
  collectSecrets,
  fromBase64Url,
  generateRecipient,
  importRecipientKey,
  MAX_PARTS,
  openBundle,
  productionShaped,
  sealBundle,
  toBase64Url,
} from "./seal-bundle.mjs";

/**
 * The bundle round trip on workerd's WebCrypto. The workflow seals on Node 22
 * with the same calls; the rig opens on Node too.
 */
describe("the sealed bundle", () => {
  const plaintext = { v: 1, secrets: { STRIPE_SECRET_KEY: "sk_test_rig_sandbox_0123456789", RIG_APP_ID: "12345" } };

  it("opens with the rig's key to exactly what was sealed", async () => {
    const recipient = await generateRecipient();
    const bundle = await sealBundle(recipient.publicKey, plaintext);
    expect(bundle).toMatchObject({ v: 1, alg: "X25519-HKDF-SHA256-A256GCM" });
    expect(JSON.stringify(bundle)).not.toContain("sk_test_rig_sandbox");
    const key = await importRecipientKey(recipient.privateKeyJwk);
    expect(await openBundle(key, bundle)).toEqual(plaintext);
  });

  it("refuses another rig's key", async () => {
    const intended = await generateRecipient();
    const other = await generateRecipient();
    const bundle = await sealBundle(intended.publicKey, plaintext);
    await expect(openBundle(await importRecipientKey(other.privateKeyJwk), bundle)).rejects.toThrow(/another key/);
  });

  it("refuses any tampered field", async () => {
    const recipient = await generateRecipient();
    const key = await importRecipientKey(recipient.privateKeyJwk);
    const bundle = await sealBundle(recipient.publicKey, plaintext);
    const flip = (b64: string) => {
      const bytes = fromBase64Url(b64);
      bytes[0] ^= 1;
      return toBase64Url(bytes);
    };
    await expect(openBundle(key, { ...bundle, ct: flip(bundle.ct) })).rejects.toThrow();
    await expect(openBundle(key, { ...bundle, iv: flip(bundle.iv) })).rejects.toThrow();
    await expect(openBundle(key, { ...bundle, sealed_at: "2020-01-01T00:00:00.000Z" })).rejects.toThrow();
    await expect(openBundle(key, { ...bundle, v: 2 })).rejects.toThrow(/version/);
  });

  it("refuses a low-order ephemeral key", async () => {
    const recipient = await generateRecipient();
    const key = await importRecipientKey(recipient.privateKeyJwk);
    const bundle = await sealBundle(recipient.publicKey, plaintext);
    await expect(openBundle(key, { ...bundle, epk: toBase64Url(new Uint8Array(32)) })).rejects.toThrow();
  });

  it("splits into parts the edge reassembles, and refuses a bundle too large for them", async () => {
    const recipient = await generateRecipient();
    const bundle = await sealBundle(recipient.publicKey, { secrets: { BIG: "x".repeat(10_000) } });
    const bulk: Record<string, string> = bundleParts(bundle);
    const count = Number(bulk.RIG_SECRET_BUNDLE_PARTS);
    expect(count).toBeGreaterThan(1);
    let joined = "";
    for (let i = 1; i <= count; i++) {
      expect(bulk[`RIG_SECRET_BUNDLE_${i}`].length).toBeLessThanOrEqual(4000);
      joined += bulk[`RIG_SECRET_BUNDLE_${i}`];
    }
    expect(JSON.parse(joined)).toEqual(bundle);
    const huge = await sealBundle(recipient.publicKey, { secrets: { BIG: "x".repeat(4000 * MAX_PARTS) } });
    expect(() => bundleParts(huge)).toThrow(/parts/);
  });
});

describe("what gets sealed", () => {
  it("takes the BUNDLE__ variables with values, by name", () => {
    expect(
      collectSecrets({ BUNDLE__STRIPE_SECRET_KEY: "sk_test_x", BUNDLE__RIG_APP_KEY: "", OTHER: "y", BUNDLE__bad: "z" }),
    ).toEqual({ secrets: { STRIPE_SECRET_KEY: "sk_test_x" }, absent: ["RIG_APP_KEY"] });
  });

  it("names production-shaped values so the workflow can refuse them", () => {
    const live = ["sk", "live", "0123456789"].join("_");
    const restricted = ["rk", "live", "0123456789"].join("_");
    const supabase = ["sb", "secret", "0123456789"].join("_");
    const pooler = ["postgresql://postgres.example", "fixture@aws-0-ca.pooler.supabase.com:6543/postgres"].join(":");
    expect(
      productionShaped({
        A: live,
        B: restricted,
        C: supabase,
        D: pooler,
        E: "sk_test_rig_sandbox_0123456789",
        F: '{"type":"service_account","project_id":"nonprod-fixture"}',
      }),
    ).toEqual(["A", "B", "C", "D"]);
  });
});

describe("the edge's own secrets", () => {
  it("writes only provisioned, well-shaped values", () => {
    const digest = "a".repeat(64);
    expect(
      edgeSecrets({
        TOKEN_SHA256_RIG: digest,
        TOKEN_SHA256_TRIAGE: "",
        SENTRY_SYNTHETIC_DSN: "https://key@o1.ingest.sentry.io/101",
        UNRELATED: "x",
      }),
    ).toEqual({ bulk: { TOKEN_SHA256_RIG: digest, SENTRY_SYNTHETIC_DSN: "https://key@o1.ingest.sentry.io/101" }, malformed: [] });
    expect(edgeSecrets({ TOKEN_SHA256_RIG: "plaintext-token", SENTRY_PROD_DSN: "not a dsn" }).malformed).toEqual([
      "TOKEN_SHA256_RIG",
      "SENTRY_PROD_DSN",
    ]);
  });
});
