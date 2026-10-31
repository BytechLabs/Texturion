/**
 * The rig's numbers by role (ROBOT-1, DEV-W1, ...), read from the rig's
 * secret store. The repository is public, so no number is ever written in
 * code; everything here names a role.
 */
import { readFileSync } from "node:fs";
import type { NumberBook } from "./robot.ts";

const E164 = /^\+[1-9]\d{7,14}$/;
const ROLE = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/;

export function numberBook(entries: Record<string, string>): NumberBook {
  const byRole = new Map<string, string>();
  const byNumber = new Map<string, string>();
  for (const [role, number] of Object.entries(entries)) {
    if (!ROLE.test(role)) throw new Error(`numbers: "${role}" is not a role name like ROBOT-1`);
    if (!E164.test(number)) throw new Error(`numbers: ${role} is not an E.164 number`);
    if (byNumber.has(number)) throw new Error(`numbers: ${role} repeats ${byNumber.get(number)}'s number`);
    byRole.set(role, number);
    byNumber.set(number, role);
  }
  return {
    number: (role) => byRole.get(role),
    role: (e164) => byNumber.get(e164),
  };
}

/**
 * The store's `standing-numbers.json` or the partition's `standing`:
 * `[{ role, e164, ... }]`. With the live owned list given,
 * every number must be in it, so a stale file cannot name a number the rig no
 * longer owns.
 */
export function standingBook(entries: unknown, owned?: readonly string[]): NumberBook {
  if (!Array.isArray(entries)) throw new Error("numbers: the standing numbers must be a list of { role, e164 }");
  const map: Record<string, string> = {};
  const live = owned ? new Set(owned) : undefined;
  for (const entry of entries as { role?: unknown; e164?: unknown }[]) {
    if (typeof entry?.role !== "string" || typeof entry.e164 !== "string") {
      throw new Error("numbers: every standing number needs a role and an e164");
    }
    if (map[entry.role]) throw new Error(`numbers: ${entry.role} is listed twice`);
    if (live && !live.has(entry.e164)) throw new Error(`numbers: ${entry.role} is not in the guard's live listing`);
    map[entry.role] = entry.e164;
  }
  return numberBook(map);
}

/** A JSON object of role to E.164, for a workstation without a store. */
export function loadNumberBook(path: string): NumberBook {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path}: numbers must be an object of role to E.164`);
  }
  for (const value of Object.values(parsed)) {
    if (typeof value !== "string") throw new Error(`${path}: every number must be a string`);
  }
  return numberBook(parsed as Record<string, string>);
}
