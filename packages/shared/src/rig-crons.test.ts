import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Pins how `scripts/check-rig-crons.mjs` reads a Worker config and CRON_JOBS,
 * and that each way the registry can disagree with them fails.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (file: string) => readFileSync(join(REPO, file), "utf8");

type Entry = Record<string, unknown>;
type Registry = { schema: string; refusal_match: Record<string, string>; crons: Entry[] };
type Judged = {
  problems: string[];
  notes: string[];
  counts: { crons: number; jobs: number; refusals: number } | null;
};
const guard = (await import(join(REPO, "scripts", "check-rig-crons.mjs"))) as {
  REGISTRY_FILE: string;
  stripJsonc: (source: string) => string;
  cronsFromConfig: (file: string, text: string) => string[];
  cronJobsFromSource: (text: string) => Map<string, string[]> | null;
  refusedFamiliesFromPolicy: (text: string) => string[] | null;
  judge: (input: {
    registry: unknown;
    configs: Record<string, string[]>;
    jobs?: Record<string, Map<string, string[]> | null>;
    families?: string[] | null;
    exact?: boolean;
  }) => Judged;
};

const API = "apps/api/wrangler.jsonc";
const WEB = "apps/web/wrangler.jsonc";

/** The real tree, read the way the script reads it. */
function realInput() {
  const configs = { [API]: guard.cronsFromConfig(API, read(API)), [WEB]: guard.cronsFromConfig(WEB, read(WEB)) };
  const jobs = { [API]: guard.cronJobsFromSource(read("apps/api/src/index.ts")) };
  const families = guard.refusedFamiliesFromPolicy(read("apps/api/src/environments/policy.ts"));
  const registry = JSON.parse(read(guard.REGISTRY_FILE)) as Registry;
  return { configs, jobs, families, registry };
}

const MATCH = {
  code: "rig_endpoint_refused",
  exception_type: "TelnyxApiError",
  message_contains: "[codes rig_endpoint_refused]",
  why: "test",
};

/** A one-cron world, so each test changes exactly one thing. */
function world(entry: Entry, jobs: string[] = ["job:a"]) {
  return {
    registry: { schema: "loonext.rig-crons.v1", refusal_match: MATCH, crons: [entry] },
    configs: { [API]: ["0 13 * * *"] },
    jobs: { [API]: new Map([["0 13 * * *", jobs]]) },
    families: ["10dlc", "porting_orders"],
  };
}
const run = { config: API, cron: "0 13 * * *", class: "run", jobs: ["job:a"] };
const refusal = {
  job: "job:a",
  code: "rig_endpoint_refused",
  telnyx_paths: ["/v2/porting_orders"],
  when: "a port is open",
  fingerprints: [["ops", "job:a"]],
};
const problems = (input: Parameters<typeof guard.judge>[0]) => guard.judge(input).problems.join("\n");

describe("reading a Worker config", () => {
  it("strips comments and trailing commas, but not a // inside a string", () => {
    const text = `{\n  // a note\n  "url": "https://example.test/a", /* b */\n  "list": [1, 2,],\n}`;
    expect(JSON.parse(guard.stripJsonc(text))).toEqual({ url: "https://example.test/a", list: [1, 2] });
  });

  it("reads triggers.crons, and an absent triggers block as none", () => {
    expect(guard.cronsFromConfig("w.jsonc", `{ "triggers": { "crons": ["*/5 * * * *"] } }`)).toEqual(["*/5 * * * *"]);
    expect(guard.cronsFromConfig("w.jsonc", `{ "name": "x" }`)).toEqual([]);
  });

  it("refuses a TOML config rather than reading it as having no crons", () => {
    expect(() => guard.cronsFromConfig("tools/x/wrangler.toml", "")).toThrow(/TOML/);
  });
});

describe("reading CRON_JOBS", () => {
  it("maps each cron to its jobs and ignores job keys quoted in comments", () => {
    const source = [
      "const before = 1;",
      "export const CRON_JOBS: Record<CronSchedule, readonly CronEntry[]> = {",
      "  // job(\"job:commented\", nope) is not a job",
      '  "*/5 * * * *": [',
      '    job("job:one", one),',
      '    /* job("job:block", nope) */ job("job:two", two),',
      "  ],",
      '  "0 13 * * *": [job("job:three", three)],',
      "};",
      'const after = job("job:outside", x);',
    ].join("\n");
    expect([...(guard.cronJobsFromSource(source) ?? new Map())]).toEqual([
      ["*/5 * * * *", ["job:one", "job:two"]],
      ["0 13 * * *", ["job:three"]],
    ]);
  });

  it("returns null for a source with no CRON_JOBS, so an old ref is noted rather than passed blind", () => {
    expect(guard.cronJobsFromSource("export const app = 1;\n")).toBeNull();
  });

  it("reads the refused path families from policy.ts", () => {
    const families = guard.refusedFamiliesFromPolicy(read("apps/api/src/environments/policy.ts"));
    expect(families).toEqual(expect.arrayContaining(["10dlc", "porting_orders", "messaging_hosted_number_orders"]));
  });
});

describe("the real registry", () => {
  it("classifies every cron in this tree, with every job compared", () => {
    const result = guard.judge({ ...realInput(), exact: true });
    expect(result.problems).toEqual([]);
    expect(result.counts?.crons).toBeGreaterThan(0);
    expect(result.counts?.jobs).toBeGreaterThan(0);
  });

  it("fails when a config gains a cron nobody classified", () => {
    const input = realInput();
    input.configs[API] = [...input.configs[API], "7 7 * * *"];
    expect(problems(input)).toMatch(/declares cron "7 7 \* \* \*" and tools\/rig\/crons\.json does not classify it/);
  });

  it("fails when a cron gains a job the registry does not list", () => {
    const input = realInput();
    const map = input.jobs[API] as Map<string, string[]>;
    map.set("0 13 * * *", [...(map.get("0 13 * * *") ?? []), "job:new"]);
    expect(problems(input)).toMatch(/runs job:new on this cron and the registry does not list it/);
  });
});

describe("registry against config", () => {
  it("fails an entry for a cron no config declares, and only notes it against an older ref", () => {
    const input = world(run);
    input.configs[API] = ["30 15 * * *"];
    input.jobs[API] = new Map([["30 15 * * *", ["job:b"]]]);
    input.registry.crons.push({ config: API, cron: "30 15 * * *", class: "run", jobs: ["job:b"] });
    expect(problems({ ...input, exact: true })).toMatch(/no tracked Worker config declares "0 13 \* \* \*".*delete the entry/);
    const older = guard.judge({ ...input, exact: false });
    expect(older.problems).toEqual([]);
    expect(older.notes.join("\n")).toMatch(/fine if the registry is newer than the ref/);
  });

  it("fails a listed job the cron no longer runs, and only notes it against an older ref", () => {
    const input = world({ ...run, jobs: ["job:a", "job:gone"] });
    expect(problems({ ...input, exact: true })).toMatch(/lists job:gone, which CRON_JOBS does not run/);
    expect(guard.judge({ ...input, exact: false }).problems).toEqual([]);
  });

  it("notes an unreadable CRON_JOBS rather than passing it silently", () => {
    const input = world(run);
    const result = guard.judge({ ...input, jobs: { [API]: null }, exact: false });
    expect(result.notes.join("\n")).toMatch(/no readable CRON_JOBS/);
  });

  it("fails when there is nothing to read", () => {
    expect(problems({ ...world(run), configs: { [API]: [] }, exact: false })).toMatch(/reading nothing/);
  });
});

describe("malformed entries", () => {
  it("passes a well-formed run and refusal", () => {
    expect(guard.judge({ ...world(run), exact: true }).problems).toEqual([]);
    const refused = { ...run, class: "run-expect-refusal", refusals: [refusal] };
    expect(guard.judge({ ...world(refused), exact: true }).problems).toEqual([]);
  });

  it("fails an unknown class, an unknown field and a bad expression", () => {
    expect(problems(world({ ...run, class: "maybe" }))).toMatch(/class "maybe" is not one of/);
    expect(problems(world({ ...run, reason: "x" }))).toMatch(/"reason" is not a field of a run entry/);
    expect(problems(world({ ...run, cron: "every day" }))).toMatch(/not a five-field cron expression/);
  });

  it("fails a cron classified twice", () => {
    const input = world(run);
    input.registry.crons.push({ ...run });
    expect(problems(input)).toMatch(/is classified twice/);
  });

  it("fails a skip with no reason, or without the liveness alerts it causes", () => {
    const skip = { config: API, cron: "0 13 * * *", class: "skip", jobs: ["job:a"] };
    expect(problems(world(skip))).toMatch(/a skip needs a reason/);
    expect(problems(world({ ...skip, reason: "x", fingerprints: [["ops", "cron:0 13 * * *"]] }))).toMatch(
      /a skip silences \["ops","job:a"\]/,
    );
    const complete = { ...skip, reason: "x", fingerprints: [["ops", "cron:0 13 * * *"], ["ops", "job:a"]] };
    expect(guard.judge({ ...world(complete), exact: true }).problems).toEqual([]);
  });

  it("fails a refusal on an endpoint rig mode does not refuse", () => {
    const entry = { ...run, class: "run-expect-refusal", refusals: [{ ...refusal, telnyx_paths: ["/v2/messages"] }] };
    expect(problems(world(entry))).toMatch(/rig mode does not refuse \/v2\/messages/);
  });

  it("fails a refusal for a job the cron does not run, or without its ops fingerprint", () => {
    const stranger = { ...run, class: "run-expect-refusal", refusals: [{ ...refusal, job: "job:z", fingerprints: [["ops", "job:z"]] }] };
    expect(problems(world(stranger))).toMatch(/job:z is not one of this cron's jobs/);
    const unprinted = { ...run, class: "run-expect-refusal", refusals: [{ ...refusal, fingerprints: [] }] };
    expect(problems(world(unprinted))).toMatch(/fingerprints must include \["ops","job:a"\]/);
  });

  it("fails a refusal_match that does not name the refusal's text", () => {
    const input = world(run);
    input.registry.refusal_match = { ...MATCH, message_contains: "refused" };
    expect(problems(input)).toMatch(/refusal_match must name code rig_endpoint_refused/);
  });
});
