/**
 * The rig's wrangler configs, derived from a ref's own.
 *
 * Derived rather than copied, so a binding added in a release reaches the rig
 * with that release. The derivation fails closed: a top-level key it has not
 * been taught is refused instead of passed through, because the failure that
 * matters here is silent. `wrangler dev` opens a remote session on the
 * production Cloudflare account for any binding it cannot emulate, and the
 * Workers AI binding was the first one found doing exactly that
 * (scripts/ci-dev-vars.mjs).
 */
import { parseJsonc } from "./jsonc.mjs";

/** The local Worker that stands in for Workers AI and forwards to the guard. */
export const AI_SHIM = { binding: "AI", service: "loonext-rig-ai-shim", entrypoint: "AiShim" };

/** Emulated by `wrangler dev`, or plain settings, so they pass through unchanged. */
const PASS_THROUGH = new Set([
  "$schema",
  "name",
  "main",
  "compatibility_date",
  "compatibility_flags",
  "workers_dev",
  "preview_urls",
  "observability",
  "durable_objects",
  "migrations",
  "vars",
  "keep_names",
  "upload_source_maps",
  "assets",
  "ratelimits",
  "limits",
  "minify",
  "no_bundle",
  "rules",
  "build",
  "alias",
  "define",
  "tsconfig",
  "find_additional_modules",
  "base_dir",
  "preserve_file_names",
  "version_metadata",
]);

/**
 * Production wiring with no meaning on the rig: routes name production
 * hostnames, and the rest reach the Cloudflare account. `env` is dropped
 * because the rig runs the top level with `--env rig`, which wrangler allows
 * only when no environment is declared.
 */
const DROPPED = new Set([
  "routes",
  "route",
  "account_id",
  "env",
  "tail_consumers",
  "logpush",
  "placement",
  "send_metrics",
  "dev",
]);

const REWRITTEN = new Set(["triggers", "unsafe", "ai", "services", "kv_namespaces"]);

export class DeriveRefusal extends Error {}

function refuse(message) {
  throw new DeriveRefusal(`rig derive: ${message}`);
}

function refuseRemote(where, entries) {
  for (const entry of entries ?? []) {
    if (entry && typeof entry === "object" && entry.remote === true) {
      refuse(`${where} binding "${entry.binding ?? entry.name}" is remote, and the rig runs nothing on the Cloudflare account`);
    }
  }
}

/**
 * The rig's copy of a Worker config.
 *
 * @param {object} config the ref's parsed wrangler config
 * @param {{ port: number, aiShim?: boolean }} options
 */
export function deriveRigConfig(config, { port, aiShim = false }) {
  const derived = {};
  for (const [key, value] of Object.entries(config)) {
    if (PASS_THROUGH.has(key)) derived[key] = value;
    else if (!DROPPED.has(key) && !REWRITTEN.has(key)) {
      refuse(`"${key}" is not a key the rig has been taught. Decide whether wrangler dev emulates it, then add it to tools/rig/src/wrangler-config.mjs`);
    }
  }

  // The rig fires every cron itself, at the time it chooses, through
  // /cdn-cgi/handler/scheduled.
  if (config.triggers !== undefined) derived.triggers = { ...config.triggers, crons: [] };

  if (config.unsafe !== undefined) {
    const { bindings = [], ...rest } = config.unsafe;
    if (Object.keys(rest).length > 0) {
      refuse(`unsafe.${Object.keys(rest)[0]} is not a key the rig has been taught`);
    }
    for (const binding of bindings) {
      // Rate limiters are emulated locally, so the production namespace ids
      // count only the rig's own traffic.
      if (binding.type !== "ratelimit") {
        refuse(`unsafe binding "${binding.name}" has type "${binding.type}", and only rate limiters are emulated`);
      }
    }
    derived.unsafe = { bindings };
  }

  refuseRemote("services", config.services);
  const services = [...(config.services ?? [])];
  if (config.ai !== undefined) {
    if (!aiShim) refuse("this config has an ai binding but no shim was asked for");
    if (config.ai.binding !== AI_SHIM.binding) {
      refuse(`the ai binding is named "${config.ai.binding}", but the shim answers as ${AI_SHIM.binding}`);
    }
    services.push({ ...AI_SHIM });
  }
  if (services.length > 0) derived.services = services;

  if (config.kv_namespaces !== undefined) {
    refuseRemote("kv", config.kv_namespaces);
    // Emulated locally either way. The id is replaced so the file the rig
    // writes never carries a production namespace.
    derived.kv_namespaces = config.kv_namespaces.map(({ binding }) => ({
      binding,
      id: `rig-local-${binding.toLowerCase()}`,
    }));
  }

  derived.dev = { ip: "127.0.0.1", port, local_protocol: "http" };
  return derived;
}

/** The file the rig writes beside the ref's own config. */
export function renderRigConfig(derived, { source, sha }) {
  return (
    `// Derived by tools/rig from ${source} at ${sha}. The next deploy rewrites it;\n` +
    "// never commit it and never edit it.\n" +
    `${JSON.stringify(derived, null, 2)}\n`
  );
}

export function deriveRigConfigText(text, options) {
  return deriveRigConfig(parseJsonc(text), options);
}

/**
 * The AI shim's config. Its source lives in the rig's own checkout, not the
 * ref's, so a ref from before the rig still gets one.
 */
export function aiShimConfig({ main, compatibilityDate, guardAiUrl }) {
  return {
    name: AI_SHIM.service,
    main,
    compatibility_date: compatibilityDate,
    vars: { GUARD_AI_URL: guardAiUrl },
  };
}
