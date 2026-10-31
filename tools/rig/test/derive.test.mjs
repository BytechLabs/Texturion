import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parseJsonc } from "../src/jsonc.mjs";
import { TOOLING_ROOT } from "../src/layout.mjs";
import {
  buildSupabaseWorkdir,
  deriveSupabaseConfig,
  generateSigningKeys,
  projectIdOf,
  setTomlKey,
} from "../src/supabase-config.mjs";
import { AI_SHIM, DeriveRefusal, deriveRigConfig, deriveRigConfigText, renderRigConfig } from "../src/wrangler-config.mjs";

const repoFile = (...parts) => readFileSync(join(TOOLING_ROOT, ...parts), "utf8");

test("JSONC keeps strings whole while dropping comments and trailing commas", () => {
  const parsed = parseJsonc(`{
    // a comment
    "url": "https://example.invalid/a//b", /* block */
    "odd": "a ,] b",
    "list": [1, 2, ],
  }`);
  assert.deepEqual(parsed, { url: "https://example.invalid/a//b", odd: "a ,] b", list: [1, 2] });
});

test("the API's derived config has no routes or crons, keeps its limiters and swaps AI for the shim", () => {
  const original = parseJsonc(repoFile("apps", "api", "wrangler.jsonc"));
  const derived = deriveRigConfig(original, { port: 8787, aiShim: true });

  assert.equal(derived.routes, undefined);
  assert.equal(derived.route, undefined);
  assert.ok(original.triggers.crons.length > 0, "the ref has crons to empty");
  assert.deepEqual(derived.triggers.crons, []);
  assert.deepEqual(derived.unsafe.bindings, original.unsafe.bindings);
  assert.ok(derived.unsafe.bindings.every((binding) => binding.type === "ratelimit"));
  assert.equal(derived.ai, undefined);
  assert.deepEqual(derived.services, [{ ...AI_SHIM }]);
  assert.deepEqual(derived.durable_objects, original.durable_objects);
  assert.equal(derived.main, original.main);
  assert.deepEqual(derived.dev, { ip: "127.0.0.1", port: 8787, local_protocol: "http" });
});

test("the derived file parses back to the same config", () => {
  const derived = deriveRigConfigText(repoFile("apps", "api", "wrangler.jsonc"), { port: 8787, aiShim: true });
  const text = renderRigConfig(derived, { source: "apps/api/wrangler.jsonc", sha: "0".repeat(40) });
  assert.deepEqual(parseJsonc(text), derived);
});

test("the web config loses its production KV id", () => {
  const original = parseJsonc(repoFile("apps", "web", "wrangler.jsonc"));
  const derived = deriveRigConfig(original, { port: 8788 });
  const productionIds = original.kv_namespaces.map((namespace) => namespace.id);
  assert.ok(productionIds.length > 0);
  for (const namespace of derived.kv_namespaces) {
    assert.ok(!productionIds.includes(namespace.id));
    assert.match(namespace.id, /^rig-local-/);
  }
  assert.deepEqual(derived.assets, original.assets);
  assert.deepEqual(derived.ratelimits, original.ratelimits);
});

test("derivation refuses what it has not been taught, and anything remote", () => {
  const base = { name: "w", main: "src/index.ts" };
  assert.throws(() => deriveRigConfig({ ...base, vectorize: [] }, { port: 1 }), DeriveRefusal);
  assert.throws(() => deriveRigConfig({ ...base, ai: { binding: "AI" } }, { port: 1 }), /no shim/);
  assert.throws(() => deriveRigConfig({ ...base, ai: { binding: "MODEL" } }, { port: 1, aiShim: true }), /answers as AI/);
  assert.throws(
    () => deriveRigConfig({ ...base, unsafe: { bindings: [{ name: "X", type: "analytics_engine" }] } }, { port: 1 }),
    /only rate limiters/,
  );
  assert.throws(
    () => deriveRigConfig({ ...base, services: [{ binding: "S", service: "prod", remote: true }] }, { port: 1 }),
    /remote/,
  );
  assert.throws(() => deriveRigConfig({ ...base, kv_namespaces: [{ binding: "K", id: "x", remote: true }] }, { port: 1 }), /remote/);
});

test("the derived config.toml points at the signing key and changes nothing else", () => {
  const committed = repoFile("supabase", "config.toml");
  const derived = deriveSupabaseConfig(committed);
  const before = committed.split(/\r?\n/);
  const after = derived.split(/\r?\n/);
  assert.equal(after.length, before.length, "the commented example line is replaced, not added to");
  const changed = after.filter((line, i) => line !== before[i]);
  assert.deepEqual(changed, ['signing_keys_path = "./signing_keys.json"']);
  assert.equal(projectIdOf(derived), projectIdOf(committed));
});

test("on the box the issuer follows the rig's Supabase origin, and TOTP is on", () => {
  const derived = deriveSupabaseConfig(repoFile("supabase", "config.toml"), {
    supabaseUrl: "https://db.rig.internal",
    appOrigin: "https://app.rig.internal",
    totp: true,
  });
  const auth = /\n\[auth\]\n([\s\S]*?)\n\[/.exec(derived.replace(/\r\n/g, "\n"))[1];
  assert.match(auth, /^jwt_issuer = "https:\/\/db\.rig\.internal\/auth\/v1"$/m);
  assert.match(auth, /^external_url = "https:\/\/db\.rig\.internal\/auth\/v1"$/m);
  assert.match(auth, /^site_url = "https:\/\/app\.rig\.internal"$/m);
  const totp = /\[auth\.mfa\.totp\]\n([\s\S]*?)\n\n/.exec(derived.replace(/\r\n/g, "\n"))[1];
  assert.match(totp, /^enroll_enabled = true$/m);
  assert.match(totp, /^verify_enabled = true$/m);
});

test("setTomlKey replaces a live key and adds a missing one under its table", () => {
  const text = "[a]\nx = 1\n# y = 0\n[b]\nx = 2\n";
  assert.equal(setTomlKey(text, "a", "x", "9"), "[a]\nx = 9\n# y = 0\n[b]\nx = 2\n");
  assert.equal(setTomlKey(text, "a", "y", "5"), "[a]\nx = 1\ny = 5\n[b]\nx = 2\n");
  assert.equal(setTomlKey(text, "b", "z", "3"), "[a]\nx = 1\n# y = 0\n[b]\nz = 3\nx = 2\n");
  assert.throws(() => setTomlKey(text, "c", "x", "1"), /no \[c\]/);
});

test("the signing key is an ES256 private JWK that signs and verifies", () => {
  const [jwk] = generateSigningKeys();
  assert.equal(jwk.alg, "ES256");
  assert.equal(jwk.crv, "P-256");
  assert.ok(jwk.d && jwk.kid);
  const privateKey = createPrivateKey({ key: jwk, format: "jwk" });
  const signature = sign("sha256", Buffer.from("rig"), privateKey);
  assert.ok(verify("sha256", Buffer.from("rig"), createPublicKey(privateKey), signature));
});

test("the working folder links to the ref and is rebuilt without touching it", () => {
  const scratch = mkdtempSync(join(tmpdir(), "rig-workdir-"));
  try {
    const ref = join(scratch, "ref");
    mkdirSync(join(ref, "supabase", "migrations"), { recursive: true });
    writeFileSync(join(ref, "supabase", "migrations", "20260101000000_a.sql"), "select 1;");
    writeFileSync(join(ref, "supabase", "seed.sql"), "-- seed");
    writeFileSync(join(ref, "supabase", "postgres-version"), "17.6.1.141\n");
    writeFileSync(join(ref, "supabase", "config.toml"), 'project_id = "Loonext"\n[auth]\n');
    const workdir = join(scratch, "work");
    for (let pass = 0; pass < 2; pass += 1) {
      const target = buildSupabaseWorkdir({ refRoot: ref, workdir, configText: "derived", signingKeys: [{ kid: "k" }] });
      assert.equal(readFileSync(join(target, "config.toml"), "utf8"), "derived");
      assert.ok(lstatSync(join(target, "migrations")).isSymbolicLink());
      assert.equal(readFileSync(join(target, "migrations", "20260101000000_a.sql"), "utf8"), "select 1;");
      assert.equal(readFileSync(join(target, ".temp", "postgres-version"), "utf8"), "17.6.1.141\n");
      assert.deepEqual(JSON.parse(readFileSync(join(target, "signing_keys.json"), "utf8")), [{ kid: "k" }]);
    }
    assert.ok(existsSync(join(ref, "supabase", "migrations", "20260101000000_a.sql")), "the rebuild kept the ref's files");
    assert.equal(readFileSync(join(ref, "supabase", "config.toml"), "utf8"), 'project_id = "Loonext"\n[auth]\n');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
