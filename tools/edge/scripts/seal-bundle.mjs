#!/usr/bin/env node
/**
 * The rig's secret bundle: sealed in rig-secrets.yml, stored on the edge as
 * ciphertext, served to the rig at /ctl/secrets, opened only on the rig.
 *
 *   node tools/edge/scripts/seal-bundle.mjs   # in rig-secrets.yml; JSON on stdout
 *
 * WHY SEALED. The edge is the one place both GitHub and the rig box can
 * reach, and an edge that could read the rig's keys would be one more place
 * to lose them. So the bundle is sealed to a key whose private half never
 * leaves the rig.
 *
 * THE FORMAT (version 1), WebCrypto only, so Node 22 and workerd both run it:
 *   1. An ephemeral X25519 key pair per bundle. Its public half is `epk`.
 *   2. shared = X25519(ephemeral private, rig public).
 *   3. key = HKDF-SHA-256(shared, salt = epk || rig public,
 *      info = "loonext-rig-bundle/v1"), 256 bits, for AES-256-GCM.
 *   4. ct = AES-GCM(key, iv, plaintext JSON), with the header
 *      `v1.<kid>.<epk>.<iv>.<sealed_at>` as additional data, so no header
 *      field can be swapped without failing the tag.
 *   All binary fields are base64url without padding. `kid` is the first 16
 *   bytes of SHA-256 over the rig's raw public key, so the rig can tell a
 *   bundle sealed to a key it has retired.
 *
 * HOW THE RIG OPENS IT. At bootstrap the rig runs `generateRecipient()`,
 * keeps `privateKeyJwk` in its secret store, and the public key becomes the
 * `rig` environment variable RIG_BUNDLE_PUBLIC_KEY. To read secrets it GETs
 * /ctl/secrets with its `rig` control token, then:
 *     const key = await importRecipientKey(privateKeyJwk);
 *     const { secrets } = await openBundle(key, bundle);
 * `openBundle` refuses another version, another kid, a low-order ephemeral
 * key (an all-zero shared secret) and any tampered byte.
 *
 * WHAT A SEALED BOX DOES NOT PROVE. Anyone holding the public key can seal a
 * bundle, so a valid one says nothing about who sealed it. Its authenticity
 * rests on where it is read from: only the edge's scoped deploy token, or the
 * account's own users, can write the edge's secrets, and the rig reads them
 * over TLS with a bearer token.
 *
 * WHAT IT SEALS. Every `BUNDLE__<NAME>` environment variable with a value,
 * under `<NAME>`. A value shaped like a production credential is refused: an
 * environment secret that is missing silently falls back to a repository
 * secret of the same name, and the repository's secrets are production's.
 *
 * Output: the JSON object `wrangler secret bulk` takes, the bundle split into
 * RIG_SECRET_BUNDLE_1..n with RIG_SECRET_BUNDLE_PARTS = n, because a Worker
 * secret holds at most 5 KB. It goes to stdout as lowercase hex, and
 * `--decode` turns the hex in $BULK back into that JSON:
 *
 *   node tools/edge/scripts/seal-bundle.mjs --decode   # in rig-secrets.yml's store job
 *
 * WHY HEX. The bundle crosses from the `seal` job to the `store` job as a job
 * output, and the runner silently drops any output that contains a string it
 * masks. It masks every secret the job read, each trimmed line of one, and
 * their base64 forms (actions/runner Worker.cs and ValueEncoders.cs), so a
 * pretty-printed JSON secret such as google-services.json makes `{`, `}` and
 * `],` masks, and any JSON output would be dropped. Hex holds no punctuation,
 * and before printing the sealer checks the hex against every one of those
 * masks, sealing again with fresh randomness on the rare collision.
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const BUNDLE_VERSION = 1;
export const BUNDLE_ALG = "X25519-HKDF-SHA256-A256GCM";
const INFO = "loonext-rig-bundle/v1";
const PREFIX = "BUNDLE__";
export const PART_SIZE = 4000;
export const MAX_PARTS = 8;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("not base64url");
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function keyId(publicRaw) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", publicRaw));
  return toBase64Url(digest.subarray(0, 16));
}

async function aesKey(shared, epk, recipientRaw, usage) {
  const material = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: concat(epk, recipientRaw), info: encoder.encode(INFO) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

function additionalData(header) {
  return encoder.encode(`v${header.v}.${header.kid}.${header.epk}.${header.iv}.${header.sealed_at}`);
}

/** A new recipient key pair for the rig: keep the JWK, publish the public key. */
export async function generateRecipient() {
  const pair = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    publicKey: toBase64Url(publicRaw),
    privateKeyJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
  };
}

/** The rig's private key, from the JWK `generateRecipient` returned. */
export function importRecipientKey(privateKeyJwk) {
  return crypto.subtle.importKey("jwk", privateKeyJwk, { name: "X25519" }, true, ["deriveBits"]);
}

/** Seals `plaintext` (any JSON value) to the rig's raw X25519 public key. */
export async function sealBundle(recipientPublicKey, plaintext, now = new Date()) {
  const recipientRaw = fromBase64Url(recipientPublicKey);
  if (recipientRaw.length !== 32) throw new Error("RIG_BUNDLE_PUBLIC_KEY must be a raw 32-byte X25519 key");
  const recipient = await crypto.subtle.importKey("raw", recipientRaw, { name: "X25519" }, false, []);
  const ephemeral = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const epk = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "X25519", public: recipient }, ephemeral.privateKey, 256),
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const header = {
    v: BUNDLE_VERSION,
    alg: BUNDLE_ALG,
    kid: await keyId(recipientRaw),
    epk: toBase64Url(epk),
    iv: toBase64Url(iv),
    sealed_at: now.toISOString(),
  };
  const key = await aesKey(shared, epk, recipientRaw, "encrypt");
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: additionalData(header) },
      key,
      encoder.encode(JSON.stringify(plaintext)),
    ),
  );
  return { ...header, ct: toBase64Url(ct) };
}

/** Opens a bundle with the rig's private CryptoKey. Throws on any mismatch. */
export async function openBundle(privateKey, bundle) {
  if (!bundle || bundle.v !== BUNDLE_VERSION || bundle.alg !== BUNDLE_ALG) {
    throw new Error("unknown bundle version");
  }
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  const recipientRaw = fromBase64Url(jwk.x);
  if (bundle.kid !== (await keyId(recipientRaw))) throw new Error("bundle sealed to another key");
  const epk = fromBase64Url(bundle.epk);
  const ephemeral = await crypto.subtle.importKey("raw", epk, { name: "X25519" }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "X25519", public: ephemeral }, privateKey, 256),
  );
  if (shared.every((byte) => byte === 0)) throw new Error("low-order ephemeral key");
  const key = await aesKey(shared, epk, recipientRaw, "decrypt");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(bundle.iv), additionalData: additionalData(bundle) },
    key,
    fromBase64Url(bundle.ct),
  );
  return JSON.parse(decoder.decode(plain));
}

/**
 * Shapes of production credentials, which never belong in the rig's bundle:
 * live Stripe keys, Supabase secret keys, a Telnyx v2 key, and a Postgres URL
 * with a password on Supabase's pooler or database hosts.
 */
const PRODUCTION_SHAPES = [
  /^sk_live_/,
  /^rk_live_/,
  /^sb_secret_/,
  /^KEY[0-9A-Za-z]{20,}_[0-9A-Za-z]{10,}$/,
  /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@[^/\s]*(?:pooler\.supabase\.com|supabase\.co)/i,
];

/** The names whose values look like production credentials. */
export function productionShaped(secrets) {
  return Object.entries(secrets)
    .filter(([, value]) => PRODUCTION_SHAPES.some((shape) => shape.test(value.trim())))
    .map(([name]) => name);
}

/** The `BUNDLE__*` variables with a value, by name, and the names left empty. */
export function collectSecrets(environment) {
  const secrets = {};
  const absent = [];
  for (const [variable, value] of Object.entries(environment)) {
    if (!variable.startsWith(PREFIX)) continue;
    const name = variable.slice(PREFIX.length);
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
    if (typeof value === "string" && value !== "") secrets[name] = value;
    else absent.push(name);
  }
  return { secrets, absent: absent.sort() };
}

/** The bundle as `wrangler secret bulk` input. */
export function bundleParts(bundle) {
  const text = JSON.stringify(bundle);
  const parts = [];
  for (let i = 0; i < text.length; i += PART_SIZE) parts.push(text.slice(i, i + PART_SIZE));
  if (parts.length > MAX_PARTS) {
    throw new Error(`bundle needs ${parts.length} parts; the edge reads at most ${MAX_PARTS}`);
  }
  const bulk = { RIG_SECRET_BUNDLE_PARTS: String(parts.length) };
  parts.forEach((part, i) => {
    bulk[`RIG_SECRET_BUNDLE_${i + 1}`] = part;
  });
  return bulk;
}

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * What the runner masks for these secret values: each value and each trimmed
 * line of it, plus the base64 of each, also shifted by one and two bytes.
 */
export function runnerMasks(values) {
  const masks = new Set();
  for (const value of values) {
    const trimmed = value.trim();
    for (const piece of [trimmed, ...trimmed.split(/[\r\n]+/).map((line) => line.trim())]) {
      if (piece === "") continue;
      masks.add(piece);
      const bytes = encoder.encode(piece);
      masks.add(toBase64(bytes));
      for (const shift of [1, 2]) if (bytes.length > shift) masks.add(toBase64(bytes.subarray(shift)));
    }
  }
  return [...masks];
}

/** The bulk JSON as lowercase hex, for a job output. */
export function encodeOutput(bulk) {
  return [...encoder.encode(JSON.stringify(bulk))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The bulk JSON back from {@link encodeOutput}'s hex. Throws on anything else. */
export function decodeOutput(hex) {
  if (typeof hex !== "string" || hex === "" || hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) {
    throw new Error("the sealed output is not hex");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const bulk = JSON.parse(decoder.decode(bytes));
  if (!bulk || typeof bulk !== "object" || typeof bulk.RIG_SECRET_BUNDLE_PARTS !== "string") {
    throw new Error("the sealed output is not a bundle");
  }
  return bulk;
}

/** How many fresh seals to try before giving up on a mask that keeps colliding. */
const SEAL_ATTEMPTS = 20;

async function main() {
  if (process.argv.includes("--decode")) {
    process.stdout.write(JSON.stringify(decodeOutput(process.env.BULK ?? "")));
    return;
  }
  const publicKey = process.env.RIG_BUNDLE_PUBLIC_KEY ?? "";
  if (!publicKey) {
    console.error("seal-bundle: RIG_BUNDLE_PUBLIC_KEY is not set in the rig environment's variables.");
    process.exit(1);
  }
  const { secrets, absent } = collectSecrets(process.env);
  const refused = productionShaped(secrets);
  if (refused.length > 0) {
    console.error(`seal-bundle: refusing production-shaped values for: ${refused.join(", ")}`);
    process.exit(1);
  }
  const names = Object.keys(secrets).sort();
  if (names.length === 0) {
    console.error("seal-bundle: no BUNDLE__ secret has a value; nothing to seal.");
    process.exit(1);
  }
  const masks = runnerMasks(Object.values(secrets));
  for (let attempt = 1; attempt <= SEAL_ATTEMPTS; attempt++) {
    const bundle = await sealBundle(publicKey, {
      v: BUNDLE_VERSION,
      sealed_at: new Date().toISOString(),
      source: {
        repository: process.env.GITHUB_REPOSITORY ?? null,
        run_id: process.env.GITHUB_RUN_ID ?? null,
        sha: process.env.GITHUB_SHA ?? null,
      },
      absent,
      secrets,
    });
    const bulk = bundleParts(bundle);
    const output = encodeOutput(bulk);
    if (masks.some((mask) => output.includes(mask))) continue;
    console.error(
      `seal-bundle: sealed ${names.length} secret(s) (${names.join(", ")}) into ` +
        `${bulk.RIG_SECRET_BUNDLE_PARTS} part(s)` +
        (absent.length > 0 ? `; empty: ${absent.join(", ")}` : ""),
    );
    process.stdout.write(output);
    return;
  }
  const colliding = names.filter((name) => runnerMasks([secrets[name]]).some((mask) => /^[0-9a-f]+$/.test(mask)));
  console.error(
    `seal-bundle: every seal contained a string the runner masks, so the job output would be dropped. ` +
      `A secret with a short hex-only line is the likely cause: ${colliding.join(", ") || "unknown"}`,
  );
  process.exit(1);
}

if (typeof process !== "undefined" && process.argv?.[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((cause) => {
    console.error(`seal-bundle: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exit(1);
  });
}
