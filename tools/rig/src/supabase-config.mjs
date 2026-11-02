/**
 * The rig's local Supabase: a derived config.toml in a working folder of its
 * own, so the committed `supabase/config.toml` stays untouched.
 *
 * The API accepts ES256 tokens only (apps/api/src/auth/jwt.ts). The pinned
 * CLI (2.109.1) already signs ES256 without a key file, but with a private key
 * built into the CLI, the same on every install (checked 2026-10-31: one kid
 * across fresh starts, no key on disk), so anyone with the CLI could mint a
 * token the rig's API accepts. The derived config names the rig's own key
 * instead, kept in the secret store so a redeploy does not sign everybody out.
 *
 * Every other line of the ref's config is kept verbatim. The CLI resolves
 * migrations, the seed and email templates against its working folder, so the
 * folder links back to the ref's own copies of those.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const SIGNING_KEYS_FILE = "signing_keys.json";

/** The key file the CLI reads: an array of private JWKs, first one signs. */
export function generateSigningKeys() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" });
  return [
    {
      kty: jwk.kty,
      kid: randomUUID(),
      use: "sig",
      key_ops: ["sign", "verify"],
      alg: "ES256",
      ext: true,
      crv: jwk.crv,
      x: jwk.x,
      y: jwk.y,
      d: jwk.d,
    },
  ];
}

function tomlString(value) {
  return JSON.stringify(value);
}

/** [start, end) of a table's body: the lines after its header up to the next header. */
function tableBody(lines, header) {
  const start = lines.findIndex((line) => line.trim() === `[${header}]`);
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !/^\s*\[/.test(lines[end])) end += 1;
  return { start: start + 1, end };
}

/**
 * Sets `key = value` inside `[header]`: replaces a live line, or the commented
 * example the CLI's template ships, or adds the key under the header.
 */
export function setTomlKey(text, header, key, value) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const body = tableBody(lines, header);
  if (body === null) throw new Error(`rig derive: config.toml has no [${header}] table`);
  const line = `${key} = ${value}`;
  const live = new RegExp(`^\\s*${key}\\s*=`);
  const commented = new RegExp(`^\\s*#\\s*${key}\\s*=`);
  let at = -1;
  for (let i = body.start; i < body.end; i += 1) if (live.test(lines[i])) at = i;
  if (at === -1) {
    for (let i = body.start; i < body.end; i += 1) if (commented.test(lines[i]) && at === -1) at = i;
  }
  if (at === -1) lines.splice(body.start, 0, line);
  else lines[at] = line;
  return lines.join(eol);
}

/**
 * @param {string} text the ref's supabase/config.toml
 * @param {{ supabaseUrl?: string, appOrigin?: string, totp?: boolean }} options
 *   supabaseUrl: the origin the API and clients use, when it is not the CLI's
 *   own 127.0.0.1 address. Tokens must carry `<supabaseUrl>/auth/v1` as their
 *   issuer, because that is what the API checks.
 *   appOrigin: where auth mail and redirects send people.
 *   totp: lets the two-factor member enrol, which S33 signs in as.
 */
export function deriveSupabaseConfig(text, { supabaseUrl, appOrigin, totp = false } = {}) {
  let next = setTomlKey(text, "auth", "signing_keys_path", tomlString(`./${SIGNING_KEYS_FILE}`));
  if (supabaseUrl !== undefined) {
    next = setTomlKey(next, "auth", "external_url", tomlString(`${supabaseUrl}/auth/v1`));
    next = setTomlKey(next, "auth", "jwt_issuer", tomlString(`${supabaseUrl}/auth/v1`));
  }
  if (appOrigin !== undefined) {
    next = setTomlKey(next, "auth", "site_url", tomlString(appOrigin));
    next = setTomlKey(
      next,
      "auth",
      "additional_redirect_urls",
      `[${tomlString(appOrigin)}, ${tomlString(`${appOrigin}/**`)}]`,
    );
  }
  // The committed config leaves confirmations off for local development, which
  // sends no sign-up mail at all; production confirms by mail, and S35 needs the mail.
  next = setTomlKey(next, "auth.email", "enable_confirmations", "true");
  if (totp) {
    next = setTomlKey(next, "auth.mfa.totp", "enroll_enabled", "true");
    next = setTomlKey(next, "auth.mfa.totp", "verify_enabled", "true");
  }
  return next;
}

/** `project_id`, which names every container the CLI starts. */
export function projectIdOf(configText) {
  const match = /^\s*project_id\s*=\s*"([^"]+)"/m.exec(configText);
  if (!match) throw new Error("rig derive: config.toml has no project_id");
  return match[1];
}

/**
 * Removes a working folder without following its links into the ref's own
 * `supabase/` folder: each link is unlinked before anything recursive runs.
 */
export function removeWorkdirTree(path) {
  if (!existsSync(path)) return;
  for (const entry of readdirSync(path)) {
    const child = join(path, entry);
    if (lstatSync(child).isSymbolicLink()) {
      try {
        unlinkSync(child);
      } catch {
        rmdirSync(child);
      }
    }
  }
  rmSync(path, { recursive: true, force: true });
}

function link(target, path) {
  if (statSync(target).isDirectory()) {
    // A junction needs no privilege on Windows; elsewhere this is a symlink.
    symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir");
  } else {
    copyFileSync(target, path);
  }
}

/**
 * Builds `<workdir>/supabase/` for `supabase --workdir <workdir>`: the derived
 * config, the signing key, the Postgres pin, and links to everything else in
 * the ref's `supabase/` folder. Rebuilt whole each time, so nothing from an
 * older ref survives into the next.
 */
export function buildSupabaseWorkdir({ refRoot, workdir, configText, signingKeys }) {
  const target = join(workdir, "supabase");
  removeWorkdirTree(target);
  mkdirSync(join(target, ".temp"), { recursive: true });
  const source = join(refRoot, "supabase");
  for (const entry of readdirSync(source)) {
    if (entry === "config.toml" || entry === ".temp" || entry === SIGNING_KEYS_FILE) continue;
    link(join(source, entry), join(target, entry));
  }
  writeFileSync(join(target, "config.toml"), configText);
  writeFileSync(join(target, SIGNING_KEYS_FILE), `${JSON.stringify(signingKeys, null, 2)}\n`, {
    mode: 0o600,
  });
  // scripts/pin-postgres-image.mjs writes the same file into the ref's own
  // folder; refs from before the pin have no supabase/postgres-version.
  const pin = join(source, "postgres-version");
  if (existsSync(pin)) {
    writeFileSync(join(target, ".temp", "postgres-version"), `${readFileSync(pin, "utf8").trim()}\n`);
  }
  return target;
}
