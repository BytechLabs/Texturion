#!/usr/bin/env node
/** #251 operator entrypoint. See deployed-capacity-lib.ts for safety rules. */
import {
  CapacityConfigError,
  CapacityRunError,
  formatCapacityEvidence,
  parseRamp,
  runHostedCapacity,
  validateHostedCapacityInput,
  type HostedScenario,
} from "./deployed-capacity-lib.ts";

const HELP = `
Usage:
  pnpm --filter @loonext/api capacity:deployed -- \\
    --target-id staging-<label> \\
    --api-origin https://<non-production-api> \\
    --supabase-origin https://<non-production-project>.supabase.co \\
    [--scenario all|api|realtime] \\
    [--api-ramp 5,10,20,40] [--realtime-ramp 5,10,20,40] \\
    [--api-rounds 3] [--deadline-ms 10000] [--dwell-ms 2000]

Required environment variables (credentials never belong on the command line):
  LOONEXT_CAPACITY_CONFIRM
  LOONEXT_CAPACITY_ACCESS_TOKEN
  LOONEXT_CAPACITY_SUPABASE_PUBLISHABLE_KEY
  LOONEXT_CAPACITY_COMPANY_ID

The confirmation value is target-bound:
  I_AUTHORIZE_NONPRODUCTION_CAPACITY_LOAD:<target-id>:<api-host>:<supabase-host>

The command rejects live Loonext targets, loopback/private targets, HTTP,
redirects, a mismatched JWT issuer, service-role keys, and failed preflights.
The dwell/cooldown must be 1000-30000ms. A suspect level is reset, checked
against a healthy serialized control, and repeated. Inconclusive/transient
records are emitted aggregate-only but the command exits nonzero.
`;

const VALUE_FLAGS = new Set([
  "--target-id",
  "--api-origin",
  "--supabase-origin",
  "--scenario",
  "--api-ramp",
  "--realtime-ramp",
  "--api-rounds",
  "--deadline-ms",
  "--dwell-ms",
]);

function argumentsMap(args: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag || !VALUE_FLAGS.has(flag)) {
      throw new CapacityConfigError("unknown or valueless command-line argument; use --help");
    }
    if (values.has(flag)) throw new CapacityConfigError("each command-line option may appear once");
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new CapacityConfigError("every command-line option requires a value");
    }
    values.set(flag, value);
    index += 1;
  }
  return values;
}

function required(values: Map<string, string>, flag: string): string {
  const value = values.get(flag);
  if (!value) throw new CapacityConfigError(`${flag} is required`);
  return value;
}

function integer(values: Map<string, string>, flag: string, fallback: number): number {
  const raw = values.get(flag);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new CapacityConfigError(`${flag} must be an integer`);
  return value;
}

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new CapacityConfigError(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  if (process.argv.slice(2).includes("--help")) {
    process.stdout.write(HELP);
    return;
  }
  const values = argumentsMap(process.argv.slice(2));
  const scenario = (values.get("--scenario") ?? "all") as HostedScenario;
  const config = validateHostedCapacityInput({
    targetId: required(values, "--target-id"),
    apiOrigin: required(values, "--api-origin"),
    supabaseOrigin: required(values, "--supabase-origin"),
    companyId: env("LOONEXT_CAPACITY_COMPANY_ID"),
    confirmation: env("LOONEXT_CAPACITY_CONFIRM"),
    accessToken: env("LOONEXT_CAPACITY_ACCESS_TOKEN"),
    supabasePublishableKey: env("LOONEXT_CAPACITY_SUPABASE_PUBLISHABLE_KEY"),
    scenario,
    apiRamp: parseRamp(values.get("--api-ramp") ?? "5,10,20,40", "--api-ramp"),
    realtimeRamp: parseRamp(
      values.get("--realtime-ramp") ?? "5,10,20,40",
      "--realtime-ramp",
    ),
    apiRounds: integer(values, "--api-rounds", 3),
    deadlineMs: integer(values, "--deadline-ms", 10_000),
    dwellMs: integer(values, "--dwell-ms", 2_000),
  });

  await runHostedCapacity(config, {
    onEvidence(evidence) {
      process.stdout.write(`${formatCapacityEvidence(evidence)}\n`);
    },
  });
}

main().catch((cause: unknown) => {
  if (cause instanceof CapacityConfigError || cause instanceof CapacityRunError) {
    process.stderr.write(`capacity: ${cause.message}\n`);
  } else {
    // External libraries sometimes put URLs or response bodies in an Error.
    // The operator gets a category, never the unreviewed error string.
    process.stderr.write("capacity: driver failed; no unreviewed error details were printed\n");
  }
  process.exitCode = 1;
});
