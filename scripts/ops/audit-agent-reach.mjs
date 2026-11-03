#!/usr/bin/env node
/**
 * D142: which credentials an agent session on this machine can reach, by
 * name and by what they reach, never by value.
 *
 *   node scripts/ops/audit-agent-reach.mjs --report   print, exit 0
 *   node scripts/ops/audit-agent-reach.mjs            the gate: see below
 *   node scripts/ops/audit-agent-reach.mjs --json     the findings as JSON
 *   node scripts/ops/audit-agent-reach.mjs --root <dir>   another clone
 *
 * WHERE IT LOOKS. This process's environment (which is the session's), the
 * `env` blocks of the Claude settings files, the env and secret files in
 * every worktree of this clone (`apps/api/.dev.vars`, commented lines
 * included, since that is where its production block lives), and every file
 * in `~/.loonext/`.
 *
 * TIERS. production-write: can change production or spend its money.
 * production-read: reads production and can change nothing (agent_diag, the
 * read-only tokens). nonprod: reaches only a sandbox, the local stack or a
 * vendor account that is not Loonext's production. none: named like a
 * credential and not one (empty, a placeholder, a public key, the Supabase
 * CLI's published local key). A value that names itself (`sk_live_`,
 * `sk_test_`, a Telnyx key, a Postgres URL's login and host, a JWT's role)
 * decides its own tier; otherwise the name does, and a name whose local and
 * production values look alike is local only on an active `.dev.vars` line. A
 * credential this script cannot place is listed as unclassified.
 *
 * THE GATE. docs/RIG.md's 2026-10-30 amendment made FA1 (agents run as a
 * user with no production write keys) optional and did not adopt it, so by
 * default this reports and passes, and says so. A founder who chooses FA1
 * sets LOONEXT_FA1=1, or writes {"fa1": true} to ~/.loonext/hardening.json;
 * from then on any production-write or unclassified credential in reach
 * fails the run, since one this script cannot place is not shown to be safe.
 * It also fails when it read nothing at all, because a blind audit passes.
 *
 * NOT CHECKED, AND SAID SO ON EVERY RUN: the Windows credential store,
 * browser sessions, and what a GitHub token's scopes allow. docs/RIG.md
 * wants the last probed against endpoints that must answer 403.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { findShapes, PUBLISHED_LOCAL_KEYS, SHAPES } from "../check-local-secrets.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const TIERS = ["production-write", "production-read", "nonprod", "none"];

/**
 * Names that hold a credential, whatever the value turns out to be. The second
 * half catches a word run into its prefix, such as PGPASSWORD.
 */
const CREDENTIAL_NAME =
  /(?:^|_)(?:KEY|KEYS|TOKEN|SECRET|SECRETS|PASSWORD|PASSWD|PASS|DSN|CREDENTIALS?|PRIVATE|DATABASE_URL|DB_URL|CONNECTION_STRING)(?:_|$)|(?:PASSWORD|PASSWD|SECRET|TOKEN|APIKEY)$/i;
const PUBLIC_NAME = /(?:^|_)(?:PUBLIC|PUBLISHABLE|ANON)(?:_|$)|^NEXT_PUBLIC_/i;
/** An address or an identifier beside a credential, not one itself, unless its value says otherwise. */
const NOT_A_SECRET_NAME = /_(?:URL|BASE|HOST|ID|NAME|PATH|FILE|REGION|ORG|PROJECT)$/i;

const PLACEHOLDER =
  /^(?:|\.{3,}|x{3,}|\*+|<[^>]*>|\$\{?\w*\}?|changeme|change-me|replace-?me|todo|none|null|unset|example|placeholder|your[-_].*|fake[-_].*|test[-_]?(?:key|token|secret)?|dummy.*|sb_secret_\.\.\.|sk_live_\.\.\.)$/i;

const LOOPBACK = /^(?:127\.\d+\.\d+\.\d+|localhost|\[::1\]|::1|host\.docker\.internal|[^.]+\.localhost|db|supabase_db_[\w-]+)$/i;

/**
 * Credentials whose value says nothing about what it reaches, by name. The
 * reason is what the report prints beside the name.
 */
const BY_NAME = [
  [/^CLOUDFLARE_.*(?:TOKEN|KEY)$/, "production-write", "a Cloudflare token for the one account, which holds production"],
  [/^(?:AGENT_LOGS_READ_TOKEN|CLOUDFLARE_LOGS_READ_TOKEN)$/, "production-read", "read-only Workers logs"],
  [/^SUPABASE_ACCESS_TOKEN$/, "production-write", "a Supabase platform token: manages the project"],
  [/^SUPABASE_DB_PASSWORD$/, "production-write", "the production database's postgres password"],
  [/^RESEND_API_KEY$/, "production-write", "sends mail as loonext.com from the one Resend team"],
  [/^(?:FCM_SERVICE_ACCOUNT|FIREBASE_SERVICE_ACCOUNT|GOOGLE_APPLICATION_CREDENTIALS)(?:_JSON)?$/, "production-write", "pushes to every app in the one Firebase project"],
  [/^(?:GITHUB_TOKEN|GH_TOKEN|GITHUB_PAT)$/, "production-write", "can merge to main, which deploys; its scopes are not probed"],
  [/^TURNSTILE_SECRET_KEY$/, "production-read", "verifies captcha answers for the production site; changes nothing"],
  [/^TELNYX_API_KEY$/, "nonprod", "not Telnyx's key shape: a guard caller token or a fake"],
  [/^(?:AHREFS_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|POSTHOG_API_KEY|POSTHOG_PERSONAL_API_KEY)$/, "nonprod", "a vendor account outside Loonext production"],
  [/^CLAUDE_CODE_\w*TOKEN$/, "nonprod", "the agent's own Claude login, outside Loonext production"],
  [/^AGENT_DIAG_DATABASE_URL$/, "production-read", "the agent_diag login"],
];

/**
 * Credentials whose local and production values look alike: local only on an
 * active `.dev.vars` line, production's anywhere else.
 */
const LOCAL_ONLY_ON_AN_ACTIVE_DEV_VARS_LINE = [
  [/^STRIPE_WEBHOOK_SECRET$/, "a Stripe signing secret"],
  [/^VAPID_PRIVATE_KEY$/, "a web-push signing key"],
];

/** Names of the one Stripe account's secret keys, which are never test-mode unless the value says so. */
const STRIPE_SECRET_NAME = /^STRIPE_(?:SECRET|RESTRICTED|API)_KEY$/;
/** Names of a Supabase key that bypasses RLS, whatever format its value is in. */
const SUPABASE_SECRET_NAME = /^(?:SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY)$/;

/**
 * In a `.dev.vars` the commented block is production's (scripts/
 * check-ignored-secrets.sh), so a value the name cannot place is taken to
 * be production's there.
 */
const COMMENTED_DEFAULT = ["production-write", "a commented .dev.vars line, which by this repo's convention is production's"];

/** A JWT's claims, or null. Supabase's legacy keys carry their role there, base64url-encoded. */
export function jwtClaims(raw) {
  const parts = raw.split(".");
  if (parts.length !== 3 || !parts[0].startsWith("eyJ")) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return claims && typeof claims === "object" ? claims : null;
  } catch {
    return null;
  }
}

function localSupabaseUrl(context) {
  try {
    return Boolean(context.SUPABASE_URL) && LOOPBACK.test(new URL(context.SUPABASE_URL).hostname);
  } catch {
    return false;
  }
}

/** PGPASSWORD goes wherever PGHOST points, and says nothing itself. */
function pgPasswordTier(raw, context) {
  const host = context.PGHOST?.trim();
  if (host && LOOPBACK.test(host)) return { tier: "nonprod", reason: "a Postgres password for a local server (PGHOST)" };
  if (/^agent_diag(?:\.|$)/.test(context.PGUSER ?? "")) {
    return { tier: "production-read", reason: "the agent_diag login's password (PGUSER)" };
  }
  if (host) return { tier: "production-write", reason: "a Postgres password for a remote server (PGHOST)" };
  if (raw === "postgres") return { tier: "nonprod", reason: "the local stack's published postgres password" };
  return { tier: "production-write", reason: "a Postgres password with no PGHOST beside it to show it is local" };
}

function postgresTier(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return null;
  const user = decodeURIComponent(url.username);
  if (!url.password) return ["none", "a Postgres URL with no password"];
  if (LOOPBACK.test(url.hostname)) return ["nonprod", "a Postgres login on the local stack"];
  if (user === "agent_diag" || user.startsWith("agent_diag.")) {
    return ["production-read", "the agent_diag login: ops_diag views only"];
  }
  return ["production-write", `a Postgres login as ${user.split(".")[0]} on a remote host`];
}

/**
 * The tier of one credential, from its value where the value names itself and
 * from its name otherwise. `context` carries the other values from the same
 * source, so a Supabase key is placed by the URL beside it. `devVars` marks a
 * `.dev.vars` source, whose active lines are local by this repo's convention.
 */
export function classify(name, value, { commented = false, devVars = false, context = {} } = {}) {
  const raw = typeof value === "string" ? value.trim().replace(/^["']|["']$/g, "") : "";
  const localLine = devVars && !commented;
  if (PLACEHOLDER.test(raw)) return { tier: "none", reason: "empty or a placeholder" };
  if (PUBLISHED_LOCAL_KEYS.has(raw)) return { tier: "nonprod", reason: "the Supabase CLI's published local key" };

  const postgres = postgresTier(raw);
  if (postgres) return { tier: postgres[0], reason: postgres[1] };

  if (/^[sr]k_live_/.test(raw)) return { tier: "production-write", reason: "a live Stripe key" };
  if (/^(?:[sr]k|pk)_test_/.test(raw)) return { tier: "nonprod", reason: "a Stripe test-mode key" };
  if (/^pk_live_/.test(raw)) return { tier: "none", reason: "a Stripe publishable key, public by design" };
  if (/^[123]x0{20,40}AA$/.test(raw)) return { tier: "nonprod", reason: "one of Cloudflare's published Turnstile test secrets" };
  if (/^KEY[0-9A-F]{24,}/.test(raw)) {
    return { tier: "production-write", reason: "a Telnyx key: the one Telnyx account is production's" };
  }
  if (/^sbp_/.test(raw)) return { tier: "production-write", reason: "a Supabase platform token: manages the project" };
  if (/^sb_publishable_/.test(raw)) return { tier: "none", reason: "a Supabase publishable key, public by design" };
  const claims = jwtClaims(raw);
  if (claims?.role === "anon") return { tier: "none", reason: "a Supabase anon key, public by design" };
  if (claims?.role === "service_role" && claims.iss === "supabase-demo") {
    return { tier: "nonprod", reason: "the Supabase CLI's published local service_role key" };
  }
  if (/^sb_secret_/.test(raw) || claims?.role === "service_role" || SUPABASE_SECRET_NAME.test(name)) {
    if (localSupabaseUrl(context)) return { tier: "nonprod", reason: "a Supabase secret key beside a local SUPABASE_URL" };
    return { tier: "production-write", reason: "a Supabase secret key: bypasses RLS on the project" };
  }
  if (/^re_[A-Za-z0-9_-]{8,}/.test(raw)) {
    return { tier: "production-write", reason: "a Resend key for the one team, which sends as loonext.com" };
  }
  if (/^(?:ghp|gho|ghu|ghs|github_pat)_/.test(raw)) {
    return { tier: "production-write", reason: "a GitHub token: can merge to main, which deploys; its scopes are not probed" };
  }

  const alike = LOCAL_ONLY_ON_AN_ACTIVE_DEV_VARS_LINE.find(([pattern]) => pattern.test(name));
  if (alike || /^whsec_/.test(raw)) {
    const what = alike ? alike[1] : "a Stripe signing secret";
    return localLine
      ? { tier: "nonprod", reason: `${what} on an active .dev.vars line, which is local` }
      : { tier: "production-write", reason: `${what}, which looks the same in production; only an active .dev.vars line is taken to be local` };
  }
  if (STRIPE_SECRET_NAME.test(name)) {
    if (/\s/.test(raw) && findShapes(raw).length === 0) {
      return { tier: "none", reason: "prose under a Stripe key's name: a Stripe key has no spaces, and none is in it" };
    }
    if (localLine) return { tier: "nonprod", reason: "a Stripe key by name on an active .dev.vars line, which is local" };
    return { tier: "production-write", reason: "a Stripe key by name whose value is not test-mode; the one Stripe account is production's" };
  }
  if (name === "PGPASSWORD") return pgPasswordTier(raw, context);

  if (PUBLIC_NAME.test(name)) return { tier: "none", reason: "a public value by name" };
  for (const [pattern, tier, reason] of BY_NAME) {
    if (pattern.test(name)) {
      if (commented && tier === "nonprod" && !/^(?:AHREFS|ANTHROPIC|OPENAI|POSTHOG|CLAUDE_CODE)/.test(name)) {
        return { tier: COMMENTED_DEFAULT[0], reason: COMMENTED_DEFAULT[1] };
      }
      return { tier, reason };
    }
  }
  if (commented && CREDENTIAL_NAME.test(name)) return { tier: COMMENTED_DEFAULT[0], reason: COMMENTED_DEFAULT[1] };
  return { tier: "unclassified", reason: "a credential this script has no rule for" };
}

/** True when a name or a value looks like a credential worth listing. */
export function isCredential(name, value) {
  const raw = typeof value === "string" ? value : "";
  const shaped =
    SHAPES.some(({ pattern }) => new RegExp(pattern.source).test(raw)) ||
    /^[a-z][a-z0-9+.-]*:\/\/[^@\s/]+:[^@\s/]+@/i.test(raw);
  if (shaped) return true;
  if (NOT_A_SECRET_NAME.test(name) && !/^(?:DATABASE_URL|DB_URL|AGENT_DIAG_DATABASE_URL)$/i.test(name)) return false;
  return CREDENTIAL_NAME.test(name);
}

/** `NAME=value` lines, including `# NAME=value`, as { name, value, commented }. */
export function parseEnvText(text) {
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(#+\s*)?(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    let value = match[3];
    const quoted = /^(["'])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, "");
    entries.push({ name: match[2], value, commented: Boolean(match[1]) });
  }
  return entries;
}

/** Every string leaf of a JSON document, named by its key. */
function jsonEntries(document) {
  const entries = [];
  const visit = (node, key) => {
    if (typeof node === "string") entries.push({ name: key ?? "", value: node, commented: false });
    else if (Array.isArray(node)) node.forEach((child) => visit(child, key));
    else if (node && typeof node === "object") {
      for (const [childKey, child] of Object.entries(node)) visit(child, childKey);
    }
  };
  visit(document, null);
  return entries;
}

function contextOf(entries) {
  const context = {};
  for (const { name, value, commented } of entries) {
    if (!commented && !(name in context)) context[name] = value;
  }
  return context;
}

function commentedContextOf(entries) {
  const context = {};
  for (const { name, value, commented } of entries) if (commented) context[name] = value;
  return context;
}

/** The credentials one source holds, classified. */
export function auditEntries(source, entries, { devVars = false } = {}) {
  const active = contextOf(entries);
  const commentedContext = commentedContextOf(entries);
  const found = [];
  for (const entry of entries) {
    if (!isCredential(entry.name, entry.value)) continue;
    const context = entry.commented ? { ...active, ...commentedContext } : active;
    const { tier, reason } = classify(entry.name, entry.value, { commented: entry.commented, devVars, context });
    found.push({ source, name: entry.name || "(unnamed)", commented: entry.commented, tier, reason });
  }
  return found;
}

function display(path, home) {
  const normal = path.split("\\").join("/");
  const homeNormal = home.split("\\").join("/");
  return normal.toLowerCase().startsWith(homeNormal.toLowerCase())
    ? `~${normal.slice(homeNormal.length)}`
    : normal;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** This clone's worktrees, or just the root when it is not a git checkout. */
export function worktrees(root) {
  try {
    const out = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const paths = [...out.matchAll(/^worktree (.+)$/gm)].map((m) => m[1].trim());
    return paths.length > 0 ? paths : [root];
  } catch {
    return [root];
  }
}

/** A file named for env values or secrets, and not an example of one. */
const ENV_FILE = /^(?:\.dev\.vars(?:\.[\w-]+)?|\.env(?:\.[\w-]+)?|[\w.-]*secrets?[\w.-]*\.json|[\w.-]*\.local\.md)$/i;

/**
 * Env and secret files in a worktree: its root, `supabase/`, and each
 * package one level under `apps/`, `packages/` and `tools/`, which is where
 * a wrangler, Next or script env file lives. A directory read rather than a
 * git listing, because asking git for ignored files costs a minute a
 * worktree on a busy machine.
 */
export function envFilesIn(tree) {
  const dirs = [tree, join(tree, "supabase")];
  for (const group of ["apps", "packages", "tools"]) {
    try {
      for (const entry of readdirSync(join(tree, group), { withFileTypes: true })) {
        if (entry.isDirectory()) dirs.push(join(tree, group, entry.name));
      }
    } catch {
      // No such group in this tree.
    }
  }
  const files = [];
  for (const dir of dirs) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && ENV_FILE.test(entry.name) && !/\.example$/i.test(entry.name)) {
        files.push(join(dir, entry.name));
      }
    }
  }
  return files;
}

/** Every source this machine gives an agent session, audited. */
export function audit({ env = process.env, home = homedir(), root = REPO_ROOT } = {}) {
  const findings = [];
  const sources = { environment: 0, settings: 0, envFiles: 0, loonext: 0, variables: 0 };

  const envEntries = Object.entries(env).map(([name, value]) => ({ name, value, commented: false }));
  sources.environment = 1;
  sources.variables = envEntries.length;
  findings.push(...auditEntries("environment", envEntries));

  const trees = worktrees(root);
  const settingsFiles = [
    join(home, ".claude", "settings.json"),
    join(home, ".claude", "settings.local.json"),
    ...trees.flatMap((tree) => [
      join(tree, ".claude", "settings.json"),
      join(tree, ".claude", "settings.local.json"),
    ]),
  ];
  for (const path of [...new Set(settingsFiles)]) {
    const document = readJson(path);
    if (!document) continue;
    sources.settings += 1;
    const block = document.env && typeof document.env === "object" ? document.env : {};
    const entries = Object.entries(block).map(([name, value]) => ({ name, value: String(value), commented: false }));
    findings.push(...auditEntries(`${display(path, home)} env`, entries));
  }

  for (const tree of trees) {
    for (const path of envFilesIn(tree)) {
      let text;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      sources.envFiles += 1;
      if (path.endsWith(".md")) {
        for (const { shape, count } of findShapes(text)) {
          findings.push({
            source: display(path, home),
            name: `${shape} x${count}`,
            commented: false,
            tier: "production-write",
            reason: "a live-secret shape check-local-secrets refuses",
          });
        }
        continue;
      }
      const document = path.endsWith(".json") ? readJson(path) : undefined;
      const entries = document ? jsonEntries(document) : parseEnvText(text);
      const devVars = /^\.dev\.vars/i.test(basename(path));
      findings.push(...auditEntries(display(path, home), entries, { devVars }));
    }
  }

  const loonext = join(home, ".loonext");
  if (existsSync(loonext)) {
    for (const name of readdirSync(loonext)) {
      const path = join(loonext, name);
      let text;
      try {
        if (!statSync(path).isFile()) continue;
        text = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      sources.loonext += 1;
      const document = name.endsWith(".json") ? readJson(path) : undefined;
      const entries = document ? jsonEntries(document) : parseEnvText(text);
      findings.push(...auditEntries(display(path, home), entries));
    }
  }

  return { findings, sources };
}

/** Whether the founder has chosen FA1, and where that was read. */
export function fa1Chosen({ env = process.env, home = homedir() } = {}) {
  if (env.LOONEXT_FA1 === "1") return { chosen: true, where: "LOONEXT_FA1=1" };
  const hardening = readJson(join(home, ".loonext", "hardening.json"));
  if (hardening && hardening.fa1 === true) return { chosen: true, where: "~/.loonext/hardening.json" };
  return { chosen: false, where: null };
}

/** The exit decision, separate from printing so it can be tested. */
export function verdict({ findings, sources }, { report, fa1 }) {
  const read = sources.variables + sources.settings + sources.envFiles + sources.loonext;
  const writes = findings.filter((f) => f.tier === "production-write");
  const unplaced = findings.filter((f) => f.tier === "unclassified");
  if (report) return { exit: 0, why: "report mode" };
  if (read === 0) return { exit: 1, why: "nothing was read, so a pass would mean nothing" };
  if (fa1.chosen && writes.length + unplaced.length > 0) {
    const why = [];
    if (writes.length > 0) why.push(`${writes.length} production-write credential(s) are in reach`);
    if (unplaced.length > 0) {
      why.push(
        `${unplaced.length} unclassified credential(s) cannot be shown not to be ` +
          "(give each a rule here, or move it out of the agent user's reach)",
      );
    }
    return { exit: 1, why: `FA1 is chosen (${fa1.where}) and ${why.join(", and ")}` };
  }
  if (fa1.chosen) {
    return { exit: 0, why: `FA1 is chosen (${fa1.where}) and no production-write or unclassified credential is in reach` };
  }
  return {
    exit: 0,
    why: "FA1 is not chosen (optional since the 2026-10-30 amendment to docs/RIG.md), so this reports and passes",
  };
}

function main() {
  const argv = process.argv.slice(2);
  const report = argv.includes("--report");
  const rootFlag = argv.indexOf("--root");
  const root = rootFlag >= 0 && argv[rootFlag + 1] ? resolve(argv[rootFlag + 1]) : REPO_ROOT;
  const result = audit({ root });
  const fa1 = fa1Chosen();
  const decision = verdict(result, { report, fa1 });

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ ...result, fa1, decision }, null, 2));
    process.exit(decision.exit);
  }

  const { findings, sources } = result;
  console.log("\naudit-agent-reach: credentials an agent session here can reach (names only, never values)\n");
  for (const tier of [...TIERS, "unclassified"]) {
    const rows = findings.filter((f) => f.tier === tier);
    console.log(`  ${tier} (${rows.length})`);
    for (const row of rows) {
      console.log(`    ${row.source}${row.commented ? " (commented)" : ""}: ${row.name}  - ${row.reason}`);
    }
  }
  console.log(
    `\n  Read: the environment (${sources.variables} variables), ${sources.settings} settings file(s), ` +
      `${sources.envFiles} env or secret file(s) across this clone's worktrees, ${sources.loonext} file(s) in ~/.loonext.`,
  );
  console.log(
    "  Not checked: the Windows credential store, browser sessions, and what a GitHub token's scopes allow.",
  );
  console.log(`\n  ${decision.exit === 0 ? "PASS" : "FAIL"}: ${decision.why}.\n`);
  process.exit(decision.exit);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
