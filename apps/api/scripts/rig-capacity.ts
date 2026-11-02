#!/usr/bin/env node
/**
 * #251 -- the capacity ramps against the Loonext rig.
 *
 * Runs ON the rig VM (docs/RIG.md). It creates one throwaway workspace with
 * realistic data volume in the rig's local Supabase, signs in as its owner
 * through the rig's real GoTrue, and hands the token to the same driver the
 * hosted ramps use (deployed-capacity-lib.ts), aimed at the rig's two names:
 *
 *   - authenticated GET /v1/for-you waves through Caddy, the API Worker under
 *     wrangler, and PostgREST, at increasing concurrency;
 *   - independent clients joining the workspace's private Realtime topic.
 *
 * The rig is not the hosted stack. It has no Supavisor and no Cloudflare edge,
 * and the Worker runs under wrangler, so every number says `environment: rig`
 * and docs/CAPACITY.md keeps the two apart.
 *
 * Nothing here can reach production: assertRigVm refuses any machine where a
 * production name resolves, the driver accepts only api.rig.internal and
 * db.rig.internal for a rig run, and the fixture is written through the local
 * database container.
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  assertRigVm,
  NotTheRigError,
  psqlSync,
  rigCaFile,
  rigPublishableKey,
  rigSecretKey,
} from "../e2e/rig-host.ts";
import {
  volumeCleanupSql,
  volumeFixtureSql,
} from "../../../scripts/load/volume-fixture.mjs";
import {
  CapacityConfigError,
  CapacityRunError,
  expectedConfirmation,
  formatCapacityEvidence,
  parseRamp,
  RIG_API_ORIGIN,
  RIG_SUPABASE_ORIGIN,
  runHostedCapacity,
  validateHostedCapacityInput,
  type HostedScenario,
} from "./deployed-capacity-lib.ts";

const HELP = `
Usage (on the rig VM, from a deployed worktree's apps/api):
  pnpm capacity:rig -- [--scenario all|api|realtime] [--conversations 5000]
    [--messages 20000] [--api-ramp 5,10,20,40] [--realtime-ramp 5,10,20,40]
    [--api-rounds 3] [--deadline-ms 10000] [--dwell-ms 2000] [--keep]

It seeds one workspace of the given size, loads it, and removes it again.
--keep leaves the workspace in place for EXPLAIN or a second run.
`;

/** One throwaway workspace, fixed so a crashed run is cleaned up by the next. */
const COMPANY = "51000000-0000-4000-8000-000000000252";
const NUMBER = "51000000-0000-4000-8000-000000000253";
const EMAIL = "capacity-251@rig.internal";
const TARGET_ID = "rig-capacity-251";

const VALUE_FLAGS = new Set([
  "--scenario",
  "--conversations",
  "--messages",
  "--api-ramp",
  "--realtime-ramp",
  "--api-rounds",
  "--deadline-ms",
  "--dwell-ms",
]);

function parseArguments(args: string[]): { values: Map<string, string>; keep: boolean } {
  const values = new Map<string, string>();
  let keep = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--keep") {
      keep = true;
      continue;
    }
    if (!flag || !VALUE_FLAGS.has(flag)) {
      throw new CapacityConfigError("unknown or valueless command-line argument; use --help");
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new CapacityConfigError("every command-line option requires a value");
    }
    values.set(flag, value);
    index += 1;
  }
  return { values, keep };
}

function integer(values: Map<string, string>, flag: string, fallback: number): number {
  const raw = values.get(flag);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new CapacityConfigError(`${flag} must be a positive integer`);
  }
  return value;
}

/** Node reads NODE_EXTRA_CA_CERTS once at start, so the CA needs a fresh process. */
function ensureRigCaTrusted(): void {
  if (process.env.NODE_EXTRA_CA_CERTS === rigCaFile()) return;
  if (!existsSync(rigCaFile())) {
    throw new NotTheRigError("the rig CA certificate is missing from the secret store");
  }
  const child = spawnSync(
    process.execPath,
    [...process.execArgv, ...process.argv.slice(1)],
    { stdio: "inherit", env: { ...process.env, NODE_EXTRA_CA_CERTS: rigCaFile() } },
  );
  process.exit(child.status ?? 1);
}

/** The fixture's rows and its login, removed; safe when neither exists. */
async function removeWorkspace(admin: SupabaseClient): Promise<void> {
  const owner = psqlSync(`select id from auth.users where email = '${EMAIL}';`).trim();
  psqlSync(`
    ${volumeCleanupSql({ company: COMPANY })}
    ${owner ? `delete from public.profiles where user_id = '${owner}';` : ""}
  `);
  if (owner) {
    const { error } = await admin.auth.admin.deleteUser(owner);
    if (error) throw new CapacityRunError("the fixture login could not be removed");
  }
}

async function main(): Promise<void> {
  if (process.argv.slice(2).includes("--help")) {
    process.stdout.write(HELP);
    return;
  }
  const { values, keep } = parseArguments(process.argv.slice(2));
  const conversations = integer(values, "--conversations", 5_000);
  const messages = integer(values, "--messages", conversations * 4);
  const scenario = (values.get("--scenario") ?? "all") as HostedScenario;

  await assertRigVm();
  ensureRigCaTrusted();

  const admin = createClient(RIG_SUPABASE_ORIGIN, rigSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await removeWorkspace(admin);

  const password = randomBytes(24).toString("base64url");
  const created = await admin.auth.admin.createUser({
    email: EMAIL,
    password,
    email_confirm: true,
  });
  const ownerId = created.data.user?.id;
  if (created.error || !ownerId) {
    throw new CapacityRunError("the fixture login could not be created");
  }

  try {
    const seeded = Date.now();
    // The rig database refuses any outbound message row to a number outside
    // its partition (rig_gate_outbound_message), because on the rig a row like
    // that can become a real text. The fixture's history is delivered and
    // fictional, and nothing here dispatches it, so the gate is lifted for
    // this one transaction and for no other statement.
    psqlSync(
      "begin;\nset local loonext.deploy_env = 'local';\n" +
      volumeFixtureSql({
        company: COMPANY,
        owner: ownerId,
        number: NUMBER,
        e164: "+14155550152",
        areaCode: "415",
        country: "US",
        conversations,
        messages,
        provisioningKey: "capacity-251-rig",
        companyName: "Rig Capacity Fixture",
        active: true,
      }) + "\ncommit;\n",
    );
    process.stderr.write(
      `capacity: seeded ${conversations} conversations and ${messages} messages in ` +
        `${((Date.now() - seeded) / 1000).toFixed(1)}s\n`,
    );

    const publishable = rigPublishableKey();
    const signedIn = await createClient(RIG_SUPABASE_ORIGIN, publishable, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).auth.signInWithPassword({ email: EMAIL, password });
    const accessToken = signedIn.data.session?.access_token;
    if (signedIn.error || !accessToken) {
      throw new CapacityRunError("the fixture login could not sign in");
    }

    const input = {
      targetId: TARGET_ID,
      targetKind: "rig" as const,
      apiOrigin: RIG_API_ORIGIN,
      supabaseOrigin: RIG_SUPABASE_ORIGIN,
      companyId: COMPANY,
      confirmation: expectedConfirmation({
        targetId: TARGET_ID,
        apiOrigin: RIG_API_ORIGIN,
        supabaseOrigin: RIG_SUPABASE_ORIGIN,
        targetKind: "rig",
      }),
      accessToken,
      supabasePublishableKey: publishable,
      scenario,
      apiRamp: parseRamp(values.get("--api-ramp") ?? "5,10,20,40", "--api-ramp"),
      realtimeRamp: parseRamp(
        values.get("--realtime-ramp") ?? "5,10,20,40",
        "--realtime-ramp",
      ),
      apiRounds: integer(values, "--api-rounds", 3),
      deadlineMs: integer(values, "--deadline-ms", 10_000),
      dwellMs: integer(values, "--dwell-ms", 2_000),
      fixture: {
        workspace_conversations: conversations,
        workspace_messages: messages,
      },
    };
    const config = validateHostedCapacityInput(input);
    await runHostedCapacity(config, {
      onEvidence(evidence) {
        process.stdout.write(`${formatCapacityEvidence(evidence)}\n`);
      },
    });
  } finally {
    if (keep) {
      process.stderr.write("capacity: --keep, the fixture workspace was left in place\n");
    } else {
      await removeWorkspace(admin);
    }
  }
}

main().catch((cause: unknown) => {
  if (
    cause instanceof CapacityConfigError ||
    cause instanceof CapacityRunError ||
    cause instanceof NotTheRigError
  ) {
    process.stderr.write(`capacity: ${cause.message}\n`);
  } else {
    // External libraries sometimes put URLs or response bodies in an Error.
    process.stderr.write("capacity: driver failed; no unreviewed error details were printed\n");
  }
  process.exitCode = 1;
});
