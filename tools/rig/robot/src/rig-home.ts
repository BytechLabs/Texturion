/**
 * Where the rig keeps things, as the `rig` CLI lays them out
 * (tools/rig/src/layout.mjs): `$RIG_HOME` (default /var/lib/loonext-rig) holds
 * `rig.json`, `secrets/` (one file per secret, mode 0700), `work/` and
 * `state/`. rigd reads the same store and publishes into the same state
 * folder, so `rig health` can read what it writes.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface RigHome {
  home: string;
  secrets: string;
  state: string;
  work: string;
  supabaseWorkdir: string;
  settingsFile: string;
}

export function rigHome(env: NodeJS.ProcessEnv = process.env): RigHome {
  const home = resolve(env.RIG_HOME ?? "/var/lib/loonext-rig");
  return {
    home,
    secrets: resolve(env.RIG_SECRETS_DIR ?? join(home, "secrets")),
    state: join(home, "state"),
    work: join(home, "work"),
    supabaseWorkdir: join(home, "work", "supabase"),
    settingsFile: join(home, "rig.json"),
  };
}

/** The settings rigd reads from rig.json, with the CLI's defaults. */
export interface RigSettings {
  appOrigin: string;
  apiPort: number;
  sentryRelayOrigin: string;
  /** Off on a workstation running a spike: no user manager runs the units. */
  systemd: boolean;
}

const SETTING_DEFAULTS: RigSettings = {
  appOrigin: "https://app.rig.internal",
  apiPort: 8787,
  sentryRelayOrigin: "http://127.0.0.1:8790",
  systemd: true,
};

export function rigSettings(home: RigHome): RigSettings {
  if (!existsSync(home.settingsFile)) return { ...SETTING_DEFAULTS };
  const parsed = JSON.parse(readFileSync(home.settingsFile, "utf8")) as Partial<RigSettings>;
  return {
    appOrigin: typeof parsed.appOrigin === "string" ? parsed.appOrigin : SETTING_DEFAULTS.appOrigin,
    apiPort: typeof parsed.apiPort === "number" ? parsed.apiPort : SETTING_DEFAULTS.apiPort,
    sentryRelayOrigin:
      typeof parsed.sentryRelayOrigin === "string" ? parsed.sentryRelayOrigin : SETTING_DEFAULTS.sentryRelayOrigin,
    systemd: typeof parsed.systemd === "boolean" ? parsed.systemd : SETTING_DEFAULTS.systemd,
  };
}

const NAME = /^[a-z0-9][a-z0-9.-]*$/;

/** A secret the store does not hold. The message names the file, never a value. */
export class MissingSecret extends Error {
  constructor(name: string, dir: string) {
    super(`rig secrets: ${name} is not in the store (${dir})`);
    this.name = "MissingSecret";
  }
}

/** The secret store: one file per secret, read trimmed, written 0600 by rename. */
export class SecretFiles {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  has(name: string): boolean {
    return existsSync(this.#path(name));
  }

  read(name: string): string {
    const path = this.#path(name);
    if (!existsSync(path)) throw new MissingSecret(name, this.dir);
    return readFileSync(path, "utf8").trim();
  }

  readOptional(name: string): string | undefined {
    return this.has(name) ? this.read(name) : undefined;
  }

  readJson<T>(name: string): T {
    const text = this.read(name);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`rig secrets: ${name} is not valid JSON`);
    }
  }

  write(name: string, value: string): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const path = this.#path(name);
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, `${value.trim()}\n`, { mode: 0o600 });
    renameSync(temp, path);
    chmodSync(path, 0o600);
  }

  #path(name: string): string {
    if (!NAME.test(name)) throw new Error(`rig secrets: "${name}" is not a secret name`);
    return join(this.dir, name);
  }
}

/**
 * A sealed bundle's secret name (`BUNDLE__<NAME>` in the `rig` environment)
 * as a store file: lower case, `_` to `-`, and a trailing `_JSON` as `.json`.
 * GUARD_TOKEN_ROBOT is `guard-token-robot`; STANDING_NUMBERS_JSON is
 * `standing-numbers.json`.
 */
export function storeNameOf(bundleName: string): string {
  if (!/^[A-Z][A-Z0-9_]*$/.test(bundleName)) throw new Error(`rig secrets: "${bundleName}" is not a bundle name`);
  const json = bundleName.endsWith("_JSON");
  const stem = (json ? bundleName.slice(0, -"_JSON".length) : bundleName).toLowerCase().replace(/_+/g, "-");
  return json ? `${stem}.json` : stem;
}

/** Local Supabase, as `supabase status` reports it; refused unless it is this machine. */
export interface LocalSupabase {
  apiUrl: string;
  secretKey: string;
  publishableKey: string;
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return LOCAL_HOSTS.has(host) || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

/** The CLI version CI pins, read from checks.yml as the `rig` CLI reads it. */
export function pinnedSupabaseCli(repoRoot: string): string {
  const workflow = readFileSync(join(repoRoot, ".github", "workflows", "checks.yml"), "utf8");
  const match = /supabase\/setup-cli@\S+[^\n]*\n\s*with:\s*\n\s*version:\s*([0-9]+\.[0-9]+\.[0-9]+)/.exec(workflow);
  if (!match) throw new Error("rigd: cannot find the Supabase CLI version pinned in checks.yml");
  return match[1]!;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

export function localSupabase(home: RigHome, env: NodeJS.ProcessEnv = process.env): LocalSupabase {
  const command = env.RIG_SUPABASE_CLI ?? "pnpm";
  const prefix = env.RIG_SUPABASE_CLI ? [] : ["dlx", `supabase@${pinnedSupabaseCli(REPO_ROOT)}`];
  const result = spawnSync(command, [...prefix, "status", "-o", "json", "--workdir", home.supabaseWorkdir], {
    encoding: "utf8",
    timeout: 60_000,
  });
  if (result.status !== 0) throw new Error("rigd: supabase status failed; is the local stack up?");
  const parsed = JSON.parse(result.stdout.slice(result.stdout.indexOf("{"))) as Record<string, string | undefined>;
  const apiUrl = parsed.API_URL ?? parsed.api_url;
  const secretKey = parsed.SECRET_KEY ?? parsed.secret_key ?? parsed.SERVICE_ROLE_KEY;
  const publishableKey = parsed.PUBLISHABLE_KEY ?? parsed.publishable_key ?? parsed.ANON_KEY;
  if (!apiUrl || !secretKey || !publishableKey) throw new Error("rigd: supabase status lacks the URL or keys");
  if (!isLoopbackUrl(apiUrl)) throw new Error("rigd: supabase status describes a remote host; the rig only uses its own");
  return { apiUrl, secretKey, publishableKey };
}

/** Writes a state file other tools read, by rename so no reader sees half of it. */
export function publishState(home: RigHome, name: string, value: unknown): void {
  mkdirSync(home.state, { recursive: true });
  const path = join(home.state, name);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, path);
}

export function readState<T>(home: RigHome, name: string): T | undefined {
  const path = join(home.state, name);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** robotd's loopback token, shared by rigd and scenario runs: made once, kept in the store. */
export function robotLocalToken(store: SecretFiles): string {
  const existing = store.readOptional("robot-local-token");
  if (existing) return existing;
  const token = randomBytes(32).toString("hex");
  store.write("robot-local-token", token);
  return token;
}
