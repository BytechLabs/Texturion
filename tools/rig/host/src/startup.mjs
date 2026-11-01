// `hostd install-startup`: a per-user Startup entry that runs `hostd serve`
// at logon. It needs no administrator, and it is a persistent change to the
// workstation, so it is written only when the caller passes --yes.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const STARTUP_NAME = "loonext-rig-hostd.cmd";

export function startupPath(env = process.env) {
  if (!env.APPDATA) throw new Error("install-startup: APPDATA is not set");
  return join(env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", STARTUP_NAME);
}

const cmdSafe = (value, what) => {
  if (/["%^&|<>\r\n]/.test(value)) throw new Error(`install-startup: the ${what} path has a character cmd.exe would read`);
  return value;
};

/** The .cmd itself: CRLF, the root fixed, hostd started minimised. */
export function startupScript({ node, hostd, root }) {
  return [
    "@echo off",
    `rem Loonext rig: starts hostd at logon (tools/rig/host/hostd.mjs install-startup).`,
    `set "RIG_HOST_ROOT=${cmdSafe(root, "root")}"`,
    `start "loonext-rig-hostd" /min "${cmdSafe(node, "node")}" "${cmdSafe(hostd, "hostd")}" serve`,
    "",
  ].join("\r\n");
}

export function installStartup({ node, hostd, root, env = process.env }) {
  const path = startupPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, startupScript({ node, hostd, root }));
  return path;
}
