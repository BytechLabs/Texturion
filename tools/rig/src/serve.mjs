/**
 * `rig serve api|web|stripe`: what the systemd units run, in the foreground,
 * from the deployed worktree. Run by hand, it is the same process.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { start } from "./exec.mjs";

function wranglerBin(appDir) {
  const bin = join(appDir, "node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
  if (!existsSync(bin)) throw new Error(`rig serve: ${appDir} has no installed wrangler; deploy first`);
  return bin;
}

/**
 * The argument lists, exported so a test can pin what the units run.
 * `--env rig` makes wrangler read `.dev.vars.rig`; the derived configs declare
 * no environments, which wrangler then treats as the top level.
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

export function serve(service, { root, layout, settings, store }) {
  let child;
  if (service === "stripe") {
    // The key goes in the environment, never on a command line `ps` can read,
    // and never through `stripe login`, whose pairing expires.
    child = start("stripe", ["listen", "--forward-to", `http://127.0.0.1:${settings.apiPort}/webhooks/stripe`], {
      env: { STRIPE_API_KEY: store.read("stripe-secret-key") },
    });
  } else {
    const { cwd, args } = serveArgs(service, { root, layout, settings });
    const caFile = join(store.dir, "rig-ca.crt");
    child = start(wranglerBin(cwd), args, {
      cwd,
      env: {
        // The rig's own CA, so workerd trusts https://db.rig.internal. The CA
        // is name-constrained to *.rig.internal (box/bootstrap.sh).
        ...(existsSync(caFile) ? { NODE_EXTRA_CA_CERTS: caFile } : {}),
        WRANGLER_SEND_METRICS: "false",
      },
    });
  }
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  return new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
}
