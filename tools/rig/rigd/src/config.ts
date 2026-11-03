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
 *   posthog-api-key          the project's public key: scenario and infrastructure events go out with it, and the local API's own (the CLI's)
 *   posthog-personal-api-key a personal key that can run queries, for reading the local API's exceptions back (R00)
 *   posthog-project-id       the project those exceptions are read from
 *   rig-app-id, rig-app-key  the GitHub App (RIG_APP_KEY)
 *   cf-guard-attest-token    guard-attest-read, for the hourly attestation (guard-attest.ts)
 *   cloudflare-account-id    the account the guard runs in, for the same read
 *   stripe-secret-key        the existing account's test-mode key, for the scenarios' Stripe calls (FA5; the CLI's)
 *   pixel-pin                the lock PIN of every emulator, the device lane's among them
 *   hostd-token              hostd's bearer token, for the host's supervisor through the tunnel
 *   emulator-audio-proven    {"date", "flags"}, written when spike EA1 passed; without it no audio verdict is given
 *   play-services-pins.json  the Play services versionName each emulator's system image pins, by device name
 *   pixel-serial, pixel-bluetooth-mac, pixel-hub-location, pixel-hub-port
 *                            retired with the physical phone; nothing reads them, and every
 *                            serial and port comes from tools/rig/host/contract.json
 *   robot-mailbox           the robot mailbox's address, for S34
 *   standing-numbers.json    numbers by role (the CLI's)
 *   tenants.json             tenants and members (the seed's)
 *   telnyx-public-key        the account's webhook key, the API's TELNYX_PUBLIC_KEY (the CLI's)
 *   robot-webhook-secret     the secret segment of the robot's sink at the edge, /w/<secret>
 *   robot-local-token        robotd's loopback token, made here on first use
 *
 * The caps and the dial window are the registry's (registry.ts), the window
 * as the guard measures it (guard-window.ts). RIG_DIAL_CAPS and
 * RIG_DIAL_WINDOW override them, for a rig that must dial less.
 *
 * `pixel` is the device lane's emulator, the AVD rig-pixel (a Pixel 8
 * profile on an API 36 Play image); the name outlived the physical phone.
 * Every emulator is reached through hostd's tunnel: RIG_HOSTD_ORIGIN
 * (http://127.0.0.1:15900) and RIG_ADB_SERVER (127.0.0.1:15037) move its
 * ends, and both stay on loopback.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HOSTD_ORIGIN, parseAdbServer, parseHostdOrigin, RIG_ADB_SERVER, type AdbServer } from "@loonext/rig-lanes";
import { parseWindow, type DialCaps, type DialWindow } from "./budget.ts";
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
  windowOverride?: DialWindow;
  capsOverride?: DialCaps;
  /** hostd on the Windows host, through the tunnel. */
  hostdOrigin: string;
  /** The rig's adb server on the host, through the tunnel. */
  adbServer: AdbServer;
  /** Whether the rig's user manager runs rigd's units (rig.json `systemd`). */
  systemd: boolean;
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
    ...(env.RIG_DIAL_WINDOW ? { windowOverride: parseWindow(env.RIG_DIAL_WINDOW) } : {}),
    ...(env.RIG_DIAL_CAPS ? { capsOverride: parseCaps(env.RIG_DIAL_CAPS) } : {}),
    hostdOrigin: parseHostdOrigin(env.RIG_HOSTD_ORIGIN ?? HOSTD_ORIGIN),
    adbServer: env.RIG_ADB_SERVER ? parseAdbServer(env.RIG_ADB_SERVER) : RIG_ADB_SERVER,
    systemd: settings.systemd,
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

/** `daily/hourly`, e.g. 18/3. */
export function parseCaps(text: string): DialCaps {
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
