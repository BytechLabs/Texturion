/**
 * Puts rigd's units where the rig account's user manager reads them,
 * `~/.config/systemd/user`, beside the `rig` CLI's own, and starts them.
 *
 * `rig deploy` runs it through `cli.ts units --install`. New units are
 * written before stale ones go. The scenario timers and template an earlier
 * rig installed are disabled and removed here too, so a deployed rig never
 * keeps one.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Unit } from "./units.ts";

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

/** What an earlier rigd installed and nothing installs now. */
const LEGACY = /^loonext-rig-(?:scenario-.+\.timer|scenario@\.service)$/;

export function installUnits(units: Unit[], options: { unitDir: string; systemctl?: Systemctl }): InstallResult {
  const systemctl = options.systemctl ?? systemctlUser;
  mkdirSync(options.unitDir, { recursive: true });
  const written: string[] = [];
  for (const unit of units) {
    const path = join(options.unitDir, unit.name);
    if (existsSync(path) && readFileSync(path, "utf8") === unit.content) continue;
    writeFileSync(path, unit.content);
    written.push(unit.name);
  }
  const removed: string[] = [];
  for (const name of readdirSync(options.unitDir)) {
    if (!LEGACY.test(name)) continue;
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
  // enable --now starts what is stopped and leaves what runs alone.
  systemctl(["enable", "--now", ...units.map((unit) => unit.name)]);
  return { written, removed };
}
