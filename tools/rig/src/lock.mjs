import { execFileSync } from "node:child_process";
import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";

const LOCK_TTL_MS = 90 * 60 * 1000;

function readLock(path) {
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const [owner, acquiredAt] = readFileSync(path, "utf8").trim().split(/\s+/, 2);
  return { owner, acquiredAt, modifiedAt: stat.mtimeMs };
}

export function changeLock(path, action, owner) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(owner ?? "")) {
    throw new Error(`rig ${action}: give your worker name`);
  }

  const mutex = openSync(`${path}.mutex`, "a", 0o600);
  try {
    // The parent retains the open file description locked by flock on fd 3.
    execFileSync("flock", ["--exclusive", "3"], { stdio: ["ignore", "pipe", "pipe", mutex] });
    const existing = readLock(path);
    if (action === "unlock") {
      if (!existing) return "Rig is already unlocked.";
      if (existing.owner !== owner) throw new Error(`rig unlock: ${existing.owner || "another worker"} holds the lock`);
      unlinkSync(path);
      return `Rig unlocked by ${owner}.`;
    }

    const now = Date.now();
    if (existing && now - existing.modifiedAt < LOCK_TTL_MS) {
      throw new Error(`rig lock: ${existing.owner || "another worker"} holds the rig since ${existing.acquiredAt || "an unknown time"}`);
    }
    if (existing) unlinkSync(path);
    const acquiredAt = new Date(now).toISOString();
    writeFileSync(path, `${owner} ${acquiredAt}\n`, { flag: "wx", mode: 0o600 });
    return `Rig locked by ${owner} at ${acquiredAt}.`;
  } finally {
    closeSync(mutex);
  }
}
