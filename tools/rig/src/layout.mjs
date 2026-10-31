/**
 * Where the rig keeps things on the box, and its non-secret settings.
 *
 *   $RIG_HOME/rig.json      settings below, all optional
 *   $RIG_HOME/secrets/      the secret store (secrets.mjs), mode 0700
 *   $RIG_HOME/worktrees/    one git worktree per deployed SHA
 *   $RIG_HOME/current       link to the deployed worktree; the units run from it
 *   $RIG_HOME/work/         derived configs that live outside any checkout
 *   $RIG_HOME/state/        deployed.json and what rigd and the relay publish
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The checkout the rig CLI itself runs from. Deployed refs are worktrees of it. */
export const TOOLING_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const DEFAULT_SETTINGS = {
  /** Where browsers, the Pixel and the API reach Supabase, through Caddy. */
  supabaseUrl: "https://db.rig.internal",
  appOrigin: "https://app.rig.internal",
  /** Where browsers and the Pixel reach the API. Vendors see the edge instead. */
  apiOrigin: "https://api.rig.internal",
  apiPort: 8787,
  webPort: 8788,
  /** rigd's Sentry relay; the rig's DSN is rewritten to point at it. */
  sentryRelayOrigin: "http://127.0.0.1:8790",
  /** Off on a workstation running a spike: there is nothing to restart. */
  systemd: true,
  keepWorktrees: 3,
};

export function rigLayout(env = process.env) {
  const home = resolve(env.RIG_HOME ?? "/var/lib/loonext-rig");
  return {
    home,
    settingsFile: join(home, "rig.json"),
    secrets: resolve(env.RIG_SECRETS_DIR ?? join(home, "secrets")),
    worktrees: join(home, "worktrees"),
    current: join(home, "current"),
    work: join(home, "work"),
    supabaseWorkdir: join(home, "work", "supabase"),
    aiShimDir: join(home, "work", "ai-shim"),
    state: join(home, "state"),
  };
}

export function rigSettings(layout) {
  if (!existsSync(layout.settingsFile)) return { ...DEFAULT_SETTINGS };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(layout.settingsFile, "utf8"));
  } catch {
    throw new Error(`rig: ${layout.settingsFile} is not valid JSON`);
  }
  const unknown = Object.keys(parsed).filter((key) => !(key in DEFAULT_SETTINGS));
  if (unknown.length > 0) throw new Error(`rig: rig.json has unknown settings: ${unknown.join(", ")}`);
  return { ...DEFAULT_SETTINGS, ...parsed };
}
