/**
 * `rig serve api|web|stripe`: what the systemd units run, in the foreground,
 * from the deployed worktree. Run by hand, it is the same process.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { run, start } from "./exec.mjs";
import { stripeSandboxKey } from "./stripe.mjs";

function wranglerBin(appDir) {
  const bin = join(appDir, "node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
  if (!existsSync(bin)) throw new Error(`rig serve: ${appDir} has no installed wrangler; deploy first`);
  return bin;
}

/**
 * Cloudflare credentials wrangler would use to open a remote session on the
 * production account. None belongs on the rig, but a workstation shell has
 * them, so no rig Worker ever inherits them.
 */
export const CLOUDFLARE_CREDENTIALS = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_EMAIL",
  "CLOUDFLARE_ACCOUNT_ID",
  "CF_API_TOKEN",
  "CF_API_KEY",
  "CF_EMAIL",
  "CF_ACCOUNT_ID",
];

/**
 * The environment a rig Worker runs with: no Cloudflare credentials, and a
 * home and config folder of its own, so a `wrangler login` on the machine is
 * not picked up either. The home matters as much as the config folder:
 * wrangler prefers a legacy ~/.wrangler over XDG_CONFIG_HOME whenever one
 * exists.
 */
export function workerEnv(layout, caFile) {
  const home = join(layout.state, "wrangler-home");
  return {
    ...Object.fromEntries(CLOUDFLARE_CREDENTIALS.map((name) => [name, undefined])),
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: home,
    WRANGLER_SEND_METRICS: "false",
    // The rig's own CA, so workerd trusts https://db.rig.internal. The CA is
    // name-constrained to rig.internal (box/bootstrap.sh).
    ...(caFile === null ? {} : { NODE_EXTRA_CA_CERTS: caFile }),
  };
}

/**
 * The argument lists, exported so a test can pin what the units run.
 * `--env rig` selects the derived configs' `env.rig` and makes wrangler read
 * `.dev.vars.rig`.
 */
export function serveArgs(service, { root, layout, settings }) {
  if (service === "api") {
    return {
      cwd: join(root, "apps", "api"),
      args: [
        "dev",
        "--config", "wrangler.rig.jsonc",
        "--config", join(layout.aiShimDir, "wrangler.jsonc"),
        "--env", "rig",
        "--ip", "127.0.0.1",
        "--port", String(settings.apiPort),
        "--test-scheduled",
        "--persist-to", join(layout.state, "wrangler", "api"),
        "--show-interactive-dev-session=false",
      ],
    };
  }
  if (service === "web") {
    return {
      cwd: join(root, "apps", "web"),
      args: [
        "dev",
        "--config", "wrangler.rig.jsonc",
        "--env", "rig",
        "--ip", "127.0.0.1",
        "--port", String(settings.webPort),
        "--persist-to", join(layout.state, "wrangler", "web"),
        "--show-interactive-dev-session=false",
      ],
    };
  }
  throw new Error(`rig serve: unknown service ${service}`);
}

/**
 * state/serving-<service>.json: the SHA this process serves. deployed.json
 * says what the units start next; this says what started, and `rig health`
 * fails while the two differ.
 */
export function recordServing(layout, service, root, sha) {
  mkdirSync(layout.state, { recursive: true });
  writeFileSync(
    join(layout.state, `serving-${service}.json`),
    `${JSON.stringify({ service, sha, worktree: root, pid: process.pid, at: new Date().toISOString() }, null, 2)}\n`,
  );
}

export function serve(service, { root, layout, settings, store }) {
  let child;
  if (service === "stripe") {
    // The key goes in the environment, never on a command line `ps` can read,
    // and never through `stripe login`, whose pairing expires.
    child = start("stripe", ["listen", "--forward-to", `http://127.0.0.1:${settings.apiPort}/webhooks/stripe`], {
      env: { STRIPE_API_KEY: stripeSandboxKey(store) },
    });
  } else {
    const { cwd, args } = serveArgs(service, { root, layout, settings });
    const caFile = join(store.dir, "rig-ca.crt");
    const env = workerEnv(layout, existsSync(caFile) ? caFile : null);
    mkdirSync(env.HOME, { recursive: true });
    const bin = wranglerBin(cwd);
    recordServing(layout, service, root, run("git", ["-C", root, "rev-parse", "HEAD"]).stdout.trim());
    child = start(bin, args, { cwd, env });
  }
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  return new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
}
