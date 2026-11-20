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
 *   posthog-personal-api-key a personal key that can run queries, for reading the local API's exceptions (R00) and its push and ring evidence back
 *   posthog-project-id       the project those events are read from
 *   rig-app-id, rig-app-key  the GitHub App (RIG_APP_KEY)
 *   cf-guard-attest-token    guard-attest-read, for R00's version attestation (guard-attest.ts)
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
 * `pixel` is the device lane's emulator, the AVD rig-pixel (a Pixel 8
 * profile on an API 36 Play image); the name outlived the physical phone.
 * Every emulator is reached through hostd's tunnel: RIG_HOSTD_ORIGIN
 * (http://127.0.0.1:15900) and RIG_ADB_SERVER (127.0.0.1:15037) move its
 * ends, and both stay on loopback.
 */
import { resolve } from "node:path";
import { HOSTD_ORIGIN, parseAdbServer, parseHostdOrigin, RIG_ADB_SERVER } from '@loonext/rig-lanes';
import type { AdbServer } from '@loonext/rig-lanes';
import { rigRepo } from "./guard-attest.ts";
import { readState, rigHome, rigSettings, SecretFiles } from '@loonext/rig-robot';
import type { RigHome, RigSettings } from '@loonext/rig-robot';

const HERE = import.meta.dirname;

export interface RigdConfig {
  home: RigHome;
  store: SecretFiles;
  settings: RigSettings;
  edgeOrigin: string;
  registryPath: string;
  /** The deployed API on loopback, as `rig serve api` runs it. */
  localApiBase: string;
  robotBase: string;
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
    hostdOrigin: parseHostdOrigin(env.RIG_HOSTD_ORIGIN ?? HOSTD_ORIGIN),
    adbServer: env.RIG_ADB_SERVER ? parseAdbServer(env.RIG_ADB_SERVER) : RIG_ADB_SERVER,
    systemd: settings.systemd,
    repo: rigRepo(env),
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

/** The SHA `rig deploy` recorded in `state/deployed.json`; a verdict without one is refused. */
export function readDeployedSha(config: Pick<RigdConfig, "home">): string {
  const sha = (readState(config.home, "deployed.json") as { sha?: unknown } | undefined)?.sha;
  if (typeof sha !== "string" || sha === "") throw new Error("rigd: state/deployed.json names no sha; run rig deploy first");
  return sha;
}
