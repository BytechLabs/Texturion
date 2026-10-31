/**
 * Child processes for the rig CLI. Failures name the program and its exit
 * status, never its arguments, because arguments carry keys and tokens.
 */
import { spawn, spawnSync } from "node:child_process";

const WINDOWS_SHIMS = new Set(["pnpm", "npx", "npm", "corepack"]);

/**
 * On Windows, pnpm and npx are .cmd shims that only a shell can start. The
 * command line is quoted here rather than left to the shell.
 */
function spawnArgs(command, args) {
  const shim = WINDOWS_SHIMS.has(command) || /\.(?:cmd|bat)$/i.test(command);
  if (process.platform !== "win32" || !shim) {
    return { file: command, argv: args, shell: false };
  }
  const quote = (arg) => (/^[\w@%+=:,./\\-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '""')}"`);
  return { file: [command, ...args].map(quote).join(" "), argv: [], shell: true };
}

/**
 * The child's environment. A stray quote in a Windows PATH ends cmd.exe's
 * search at that entry, so a shim installed after it is "not recognized".
 */
function childEnv(env) {
  const merged = env ? { ...process.env, ...env } : { ...process.env };
  if (process.platform === "win32") {
    for (const key of Object.keys(merged)) if (/^path$/i.test(key)) merged[key] = merged[key].replace(/"/g, "");
  }
  return merged;
}

export class CommandFailed extends Error {
  constructor(command, status, stderr) {
    super(`${command} exited with ${status}${stderr ? `: ${stderr.trim().split("\n").slice(-5).join(" | ")}` : ""}`);
    this.status = status;
  }
}

/**
 * Runs to completion. Output is captured and returned unless `inherit` is
 * set, in which case it streams to the rig's own stdout and stderr.
 */
export function run(command, args = [], { cwd, env, input, inherit = false, allowFailure = false } = {}) {
  const { file, argv, shell } = spawnArgs(command, args);
  const result = spawnSync(file, argv, {
    cwd,
    env: childEnv(env),
    input,
    shell,
    encoding: "utf8",
    stdio: inherit ? ["ignore", "inherit", "inherit"] : ["pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw new CommandFailed(command, result.error.code ?? "error", "");
  if (result.status !== 0 && !allowFailure) {
    throw new CommandFailed(command, result.status, result.stderr ?? "");
  }
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/**
 * `systemctl --user` as the rig account. `sudo -iu rig` leaves
 * XDG_RUNTIME_DIR unset, and without it systemctl cannot reach the user
 * manager, which for a lingering account is always at /run/user/<uid>.
 */
export function systemctlUser(args, options = {}) {
  return run("systemctl", ["--user", ...args], { ...options, env: userManagerEnv(options.env) });
}

/** `env` plus what a child needs to reach the rig account's user manager itself. */
export function userManagerEnv(env = {}) {
  const out = { ...env };
  if (!process.env.XDG_RUNTIME_DIR && typeof process.getuid === "function") {
    out.XDG_RUNTIME_DIR = `/run/user/${process.getuid()}`;
  }
  return out;
}

/** A long-running child, its output on the rig's own. */
export function start(command, args = [], { cwd, env, logFile } = {}) {
  const { file, argv, shell } = spawnArgs(command, args);
  return spawn(file, argv, {
    cwd,
    env: childEnv(env),
    shell,
    stdio: logFile ? ["ignore", logFile, logFile] : "inherit",
  });
}
