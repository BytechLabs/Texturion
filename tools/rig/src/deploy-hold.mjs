/**
 * What a schema-change deploy leaves in the rig's state while the services
 * and timers it stopped are down: `rig deploy` writes it before it stops
 * anything and removes it only once the services serve the new ref. rigd's
 * hourly schedule refresh starts no timer while it is there, so nothing runs
 * against a database mid-migration, and a deploy that failed leaves the
 * timers stopped until one succeeds. `rig health` fails on one over an hour
 * old.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DEPLOY_HOLD_FILE = "deploy-hold.json";

/** A deploy that runs longer than this has stopped part way, or is stuck. */
export const DEPLOY_HOLD_MAX_AGE_MS = 60 * 60_000;

export function deployHoldPath(stateDir) {
  return join(stateDir, DEPLOY_HOLD_FILE);
}

export function holdForDeploy(stateDir, { sha, ref }) {
  mkdirSync(stateDir, { recursive: true });
  const hold = { sha, ref: ref ?? null, at: new Date().toISOString(), pid: process.pid };
  const path = deployHoldPath(stateDir);
  writeFileSync(`${path}.${process.pid}.tmp`, `${JSON.stringify(hold, null, 2)}\n`);
  renameSync(`${path}.${process.pid}.tmp`, path);
  return hold;
}

export function releaseDeployHold(stateDir) {
  rmSync(deployHoldPath(stateDir), { force: true });
}

/**
 * The hold, `{ unreadable: true }` for a file that is there but is not one,
 * or null when there is none. A file that cannot be read still holds.
 */
export function readDeployHold(stateDir) {
  const path = deployHoldPath(stateDir);
  if (!existsSync(path)) return null;
  try {
    const hold = JSON.parse(readFileSync(path, "utf8"));
    if (hold && typeof hold === "object" && Number.isFinite(Date.parse(hold.at))) return hold;
  } catch {
    // Reported as unreadable below.
  }
  return { unreadable: true };
}
