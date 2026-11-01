// One SSH connection from the workstation into the VM, carrying the rig's adb
// server, hostd and every emulator's console and gRPC port as reverse
// forwards. The host dials out, so nothing on the host listens beyond
// loopback, and the VM's sshd PermitListen bounds which ports it may bind.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { OPENSSH_DIR, forwardedPorts } from "./config.mjs";

export const SSH = join(OPENSSH_DIR, "ssh.exe");
export const VM_TOKEN_PATH = '"${RIG_HOME:-/var/lib/loonext-rig}/secrets/hostd-token"';

const BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000, 60_000];
const STABLE_MS = 60_000;
const UP_AFTER_MS = 5000;

/**
 * Options every connection to the VM uses: the rig's own key and no other,
 * the host key pinned in the rig's known_hosts (written when the VM was made,
 * never learned on first use), and no ssh_config from the workstation.
 */
export function sshBaseArgs(paths) {
  return [
    "-F", "none",
    "-i", paths.sshKey,
    "-o", "IdentitiesOnly=yes",
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${paths.knownHosts}`,
    "-o", "HostKeyAlgorithms=ssh-ed25519",
  ];
}

export function target(contract) {
  return `${contract.vm.user}@${contract.vm.address}`;
}

export function tunnelArgs(contract, paths) {
  const forwards = forwardedPorts(contract).flatMap(([vmPort, hostPort]) => ["-R", `127.0.0.1:${vmPort}:127.0.0.1:${hostPort}`]);
  return [
    "-N",
    "-T",
    ...sshBaseArgs(paths),
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    ...forwards,
    target(contract),
  ];
}

/** A remote command over the same pinned connection settings. */
export function commandArgs(contract, paths, command) {
  return [...sshBaseArgs(paths), "-T", target(contract), command];
}

export const remoteDigestCommand = `sha256sum < ${VM_TOKEN_PATH} 2>/dev/null || true`;
export const remoteWriteCommand =
  `umask 077 && f=${VM_TOKEN_PATH} && cat > "$f.new" && chmod 0600 "$f.new" && mv -f "$f.new" "$f"`;

export const digest = (text) => createHash("sha256").update(text).digest("hex");

export function backoffMs(attempt) {
  return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
}

/**
 * Copies hostd's token to the VM when the VM's copy differs. The token goes
 * over stdin, never on a command line.
 */
export async function syncToken({ contract, paths, run, readFile = readFileSync }) {
  const token = readFile(paths.token, "utf8");
  const remote = await run(SSH, commandArgs(contract, paths, remoteDigestCommand));
  if (remote.code !== 0) throw new Error(`could not read the VM's token digest (${remote.code})`);
  if (remote.stdout.trim().split(/\s+/)[0] === digest(token)) return false;
  const written = await run(SSH, commandArgs(contract, paths, remoteWriteCommand), { input: token });
  if (written.code !== 0) throw new Error(`could not write the VM's token (${written.code})`);
  return true;
}

/**
 * Keeps the tunnel up: sync the token, start ssh, and restart it with
 * backoff whenever it exits. The backoff resets once a connection has held
 * for a minute.
 */
export function createTunnel({
  contract,
  paths,
  spawn,
  run,
  readFile = readFileSync,
  now = () => Date.now(),
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  log = () => {},
}) {
  const state = { up: false, since: null };
  let stopped = false;
  let child = null;

  async function once() {
    try {
      if (await syncToken({ contract, paths, run, readFile })) log("tunnel: copied hostd-token to the VM");
    } catch (cause) {
      log(`tunnel: ${cause.message}`);
      return 0;
    }
    const started = now();
    child = spawn(SSH, tunnelArgs(contract, paths), { stdio: "ignore", windowsHide: true });
    const upTimer = setTimeout(() => {
      state.up = true;
      state.since = new Date(now()).toISOString();
      log("tunnel: up");
    }, UP_AFTER_MS);
    const code = await new Promise((done) => {
      child.once("exit", (exitCode) => done(exitCode));
      child.once("error", (cause) => done(cause.code ?? "error"));
    });
    clearTimeout(upTimer);
    child = null;
    if (state.up) log(`tunnel: down (${code})`);
    state.up = false;
    state.since = null;
    return now() - started;
  }

  async function loop() {
    let attempt = 0;
    while (!stopped) {
      const held = await once();
      if (stopped) break;
      attempt = held >= STABLE_MS ? 0 : attempt + 1;
      await sleep(backoffMs(attempt));
    }
  }

  return {
    state,
    start: () => {
      stopped = false;
      return loop();
    },
    stop: () => {
      stopped = true;
      child?.kill();
    },
  };
}
