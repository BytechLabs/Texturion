/**
 * #251 -- what the rig load drivers need to know about the machine they run on.
 *
 * Every driver that writes load runs ON the rig VM (docs/RIG.md), next to the
 * local Supabase stack it loads. This module is the one place that decides
 * "this really is the rig" and hands out the local stack's addresses, so no
 * driver carries its own copy of that decision.
 *
 * The refusal is a network fact rather than a flag. On the rig, `loonext.com`,
 * `supabase.co` and the carriers' API hosts resolve to nothing (docs/RIG.md,
 * "Name resolution"), and the rig's own names resolve to the rig. A machine
 * where production names resolve is not the rig, whatever its environment says,
 * and a driver that is about to write hundreds of thousands of rows refuses it.
 *
 * Plain node, erasable syntax only: both the operator scripts (type-stripped)
 * and the vitest rig suites import it.
 */
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { join } from "node:path";

export const RIG_HOME = process.env.RIG_HOME ?? "/var/lib/loonext-rig";

/** The local stack's database container: the same name `dev-seed.mjs` uses. */
export const DB_CONTAINER = "supabase_db_Loonext";
const KONG_CONTAINER = "supabase_kong_Loonext";

/** The two addresses the rig's own names may resolve to (docs/RIG.md 3.2). */
const RIG_ADDRESSES = new Set(["127.0.0.1", "192.168.70.10"]);

/** Names that must NOT resolve on the rig, because they are production's. */
const PRODUCTION_NAMES = ["api.loonext.com", "app.loonext.com", "supabase.co", "api.telnyx.com"];

export class NotTheRigError extends Error {
  constructor(reason: string) {
    super(`this is not the rig, so no load was generated: ${reason}`);
    this.name = "NotTheRigError";
  }
}

async function resolves(name: string): Promise<string | null> {
  try {
    return (await lookup(name)).address;
  } catch {
    return null;
  }
}

/**
 * Refuse to run anywhere but the rig VM. Checked, in order: a Linux host with
 * the rig's state folder, the rig's two names resolving to the rig, and none
 * of production's names resolving at all.
 */
export async function assertRigVm(): Promise<void> {
  if (process.platform !== "linux") {
    throw new NotTheRigError("the rig is a Linux VM");
  }
  if (!existsSync(join(RIG_HOME, "state", "deployed.json"))) {
    throw new NotTheRigError("no deployed rig state under RIG_HOME");
  }
  for (const name of ["api.rig.internal", "db.rig.internal"]) {
    const address = await resolves(name);
    if (address === null || !RIG_ADDRESSES.has(address)) {
      throw new NotTheRigError(`${name} does not resolve to the rig`);
    }
  }
  for (const name of PRODUCTION_NAMES) {
    if ((await resolves(name)) !== null) {
      throw new NotTheRigError("a production name resolves from here");
    }
  }
}

/** The rig CA, which Node must trust to reach https://*.rig.internal. */
export function rigCaFile(): string {
  return join(RIG_HOME, "secrets", "rig-ca.crt");
}

/**
 * The service key the deployed rig API runs with, read from its own settings
 * file. It is the local stack's key and opens nothing but the local stack, but
 * it is still never printed or written anywhere else.
 */
export function rigSecretKey(): string {
  const file = join(RIG_HOME, "current", "apps", "api", ".dev.vars.rig");
  const match = /^SUPABASE_SECRET_KEY=(.+)$/m.exec(readFileSync(file, "utf8"));
  if (!match) throw new NotTheRigError("the deployed rig API has no SUPABASE_SECRET_KEY");
  return match[1].trim().replace(/^"|"$/g, "");
}

/** The local stack's publishable key, from the gateway's own routing table. */
export function rigPublishableKey(): string {
  const text = execFileSync(
    "docker",
    ["exec", KONG_CONTAINER, "cat", "/home/kong/kong.yml"],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  const match = /sb_publishable_[A-Za-z0-9_-]+/.exec(text);
  if (!match) throw new NotTheRigError("the local gateway has no publishable key");
  return match[0];
}

const PSQL_ARGS = [
  "exec",
  "-i",
  DB_CONTAINER,
  "psql",
  "-U",
  "postgres",
  "-d",
  "postgres",
  "-v",
  "ON_ERROR_STOP=1",
  "-t",
  "-A",
];

/** SQL as the database owner, through the container. Blocks; for setup. */
export function psqlSync(sql: string): string {
  return execFileSync("docker", PSQL_ARGS, {
    input: sql,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** The same, without blocking the event loop; for polling during a burst. */
export function psql(sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "docker",
      PSQL_ARGS,
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        // The database's first complaint names the constraint or column; it
        // holds no secret, and without it a failed cleanup says nothing.
        if (error) reject(new Error(`psql failed: ${stderr.split("\n")[0] ?? ""}`));
        else resolve(stdout);
      },
    );
    child.stdin?.end(sql);
  });
}
