/**
 * Puts a schedule's units where the rig account's user manager reads them,
 * `~/.config/systemd/user`, beside the `rig` CLI's own, and starts them.
 *
 * `rig deploy` runs it through `cli.ts schedule --install`; the daemon runs it
 * again when it starts and when the guard's measured window moves, so the
 * timers always follow the registry and the window that is in force. New units
 * are written before stale ones go, so a failure part way leaves timers that
 * still fire.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Schedule } from "./schedule.ts";

export type Systemctl = (args: string[]) => void;

export interface InstallResult {
  written: string[];
  removed: string[];
}

export function userUnitDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "systemd", "user");
}

export const systemctlUser: Systemctl = (args) => {
  const result = spawnSync("systemctl", ["--user", ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`systemctl --user ${args[0]} failed: ${(result.stderr || result.stdout || "").trim()}`);
};

const OWNED = /^loonext-rig-(?:scenario-.+\.timer|scenario@\.service|rigd\.service|robotd\.service)$/;

export function installSchedule(schedule: Schedule, options: { unitDir: string; systemctl?: Systemctl }): InstallResult {
  const systemctl = options.systemctl ?? systemctlUser;
  mkdirSync(options.unitDir, { recursive: true });
  const written: string[] = [];
  const keep = new Set<string>();
  for (const unit of schedule.units) {
    keep.add(unit.name);
    const path = join(options.unitDir, unit.name);
    if (existsSync(path) && readFileSync(path, "utf8") === unit.content) continue;
    writeFileSync(path, unit.content);
    written.push(unit.name);
  }
  const removed: string[] = [];
  for (const name of readdirSync(options.unitDir)) {
    if (!OWNED.test(name) || keep.has(name)) continue;
    if (name.endsWith(".timer")) {
      try {
        systemctl(["disable", "--now", name]);
      } catch {
        // Already gone from the manager; the file goes either way.
      }
    }
    rmSync(join(options.unitDir, name), { force: true });
    removed.push(name);
  }
  if (written.length > 0 || removed.length > 0) systemctl(["daemon-reload"]);
  const timers = schedule.units.map((unit) => unit.name).filter((name) => name.endsWith(".timer"));
  // enable --now starts what is stopped and leaves what runs alone, so the
  // daemon can call this on itself, and a unit an earlier failure left off
  // is started the next time round.
  systemctl(["enable", "--now", "loonext-rig-rigd.service", "loonext-rig-robotd.service", ...timers]);
  return { written, removed };
}
