/**
 * rigd's settings: the layout and secret store the `rig` CLI keeps under
 * `$RIG_HOME` (rig-home.ts), `rig.json`, and a few environment overrides.
 * Nothing here has a default that points anywhere but the rig itself.
 *
 * Secrets rigd reads from the store, by file name:
 *   edge-origin              the edge's https origin (the CLI's)
 *   control-token-rig        the `rig` control token: /ctl/uplink, /ctl/secrets
 *   guard-token-robot        the `robot` caller token: the lease, the robot's Telnyx
 *   guard-token-rig-api      the `rig-api` caller token, the app's TELNYX_API_KEY (the CLI's)
 *   bundle-private-key.json  the X25519 JWK the secret bundle is sealed to
 *   sentry-dsn-rig           loonext-rig, which the relay forwards to (the CLI's)
 *   sentry-dsn-synthetic     loonext-synthetic, for scenario and infrastructure events
 *   rig-app-id, rig-app-key  the GitHub App (RIG_APP_KEY)
 *   standing-numbers.json    numbers by role (the CLI's)
 *   tenants.json             tenants and members (the seed's)
 *   robot-local-token        robotd's loopback token, made here on first use
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DIAL_CAPS, parseWindow, type DialCaps, type DialWindow } from "./budget.ts";
import { readState, rigHome, rigSettings, SecretFiles, type RigHome, type RigSettings } from "@loonext/rig-robot";

const HERE = dirname(fileURLToPath(import.meta.url));

export interface RigdConfig {
  home: RigHome;
  store: SecretFiles;
  settings: RigSettings;
  edgeOrigin: string;
  registryPath: string;
  /** The deployed API on loopback, as `rig serve api` runs it. */
  localApiBase: string;
  robotBase: string;
  relayPort: number;
  window: DialWindow;
  caps: DialCaps;
  repo: string;
  env: NodeJS.ProcessEnv;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RigdConfig {
  const home = rigHome(env);
  const store = new SecretFiles(home.secrets);
  const settings = rigSettings(home);
  return {
    home,
    store,
    settings,
    edgeOrigin: edgeOriginOf(store.read("edge-origin")),
    registryPath: env.RIG_REGISTRY ?? resolve(HERE, "../../scenarios.json"),
    localApiBase: `http://127.0.0.1:${settings.apiPort}`,
    robotBase: env.RIG_ROBOT_BASE ?? "http://127.0.0.1:7311",
    relayPort: Number(new URL(settings.sentryRelayOrigin).port || 8790),
    window: parseWindow(env.RIG_DIAL_WINDOW),
    caps: parseCaps(env.RIG_DIAL_CAPS),
    repo: env.RIG_REPO ?? "BytechLabs/Texturion",
    env,
  };
}

/** A bare https origin, or http on loopback for a stub edge on a workstation. */
export function edgeOriginOf(value: string): string {
  const url = new URL(value.trim());
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if ((url.protocol !== "https:" && !(loopback && url.protocol === "http:")) || url.pathname !== "/" || url.search) {
    throw new Error("rigd: edge-origin must be a bare https origin");
  }
  return url.origin;
}

/** `daily/hourly`, e.g. 18/3, the default until Telnyx states the limits in writing. */
export function parseCaps(text: string | undefined): DialCaps {
  if (!text) return { ...DEFAULT_DIAL_CAPS };
  const match = /^(\d+)\/(\d+)$/.exec(text.trim());
  if (!match) throw new Error(`RIG_DIAL_CAPS "${text}" must be daily/hourly, e.g. 18/3`);
  return { daily: Number(match[1]), hourly: Number(match[2]) };
}

/**
 * The room `rig health` publishes in `state/health.json`, from the guard. No
 * report, or no room in it, is 0: no paid call runs until the guard has said.
 */
export function readRoom(config: Pick<RigdConfig, "home">): number {
  const room = readState<{ room?: unknown }>(config.home, "health.json")?.room;
  return typeof room === "number" && Number.isInteger(room) && room >= 0 ? room : 0;
}

/** The SHA `rig deploy` recorded in `state/deployed.json`; a verdict without one is refused. */
export function readDeployedSha(config: Pick<RigdConfig, "home">): string {
  const sha = readState<{ sha?: unknown }>(config.home, "deployed.json")?.sha;
  if (typeof sha !== "string" || sha === "") throw new Error("rigd: state/deployed.json names no sha; run rig deploy first");
  return sha;
}
