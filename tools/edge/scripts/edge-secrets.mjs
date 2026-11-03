#!/usr/bin/env node
/**
 * The edge's own secrets, as `wrangler secret bulk` input, from the
 * `rig-cloud` environment rig-cloud.yml runs in.
 *
 *   node tools/edge/scripts/edge-secrets.mjs | wrangler secret bulk
 *
 * Only names with a value are written, so a secret not yet provisioned keeps
 * whatever the edge already has. A digest that is not 64 hex characters, or a
 * PostHog key that is not one, would turn a feature off silently on the edge, so it
 * fails here, where somebody reads the run. Digests are of the token or path
 * secret, never the value itself.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIGEST = /^[0-9a-f]{64}$/;
const POSTHOG_KEY = /^phc_[A-Za-z0-9]{20,}$/;

export const EDGE_SECRETS = {
  TOKEN_SHA256_RIG_API: DIGEST,
  TOKEN_SHA256_ROBOT: DIGEST,
  TOKEN_SHA256_DIAG: DIGEST,
  TOKEN_SHA256_ADMIN: DIGEST,
  TOKEN_SHA256_RIG: DIGEST,
  TOKEN_SHA256_TRIAGE: DIGEST,
  ROBOT_WEBHOOK_SECRET_SHA256: DIGEST,
  NOTIFICATIONS_SECRET_SHA256: DIGEST,
  POSTHOG_PROJECT_KEY: POSTHOG_KEY,
};

/** The secrets to write, and the names whose values have the wrong shape. */
export function edgeSecrets(environment) {
  const bulk = {};
  const malformed = [];
  for (const [name, shape] of Object.entries(EDGE_SECRETS)) {
    const value = environment[name]?.trim();
    if (!value) continue;
    if (shape.test(value)) bulk[name] = value;
    else malformed.push(name);
  }
  return { bulk, malformed };
}

function main() {
  const { bulk, malformed } = edgeSecrets(process.env);
  if (malformed.length > 0) {
    console.error(`edge-secrets: wrong shape, not written: ${malformed.join(", ")}`);
    process.exit(1);
  }
  const names = Object.keys(bulk);
  console.error(`edge-secrets: ${names.length} of ${Object.keys(EDGE_SECRETS).length} set${names.length ? `: ${names.join(", ")}` : ""}`);
  process.stdout.write(JSON.stringify(bulk));
}

if (typeof process !== "undefined" && process.argv?.[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
