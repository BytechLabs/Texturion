/**
 * `scripts/ops/set-flag.mjs` never prints a stored note, or when the flag
 * was last changed, where the log is public.
 *
 * ops.yml runs it on GitHub Actions, whose logs this public repository
 * publishes, and a note was written for the table. The script is run as CI
 * runs it, against a stand-in PostgREST whose note holds a marker and a line
 * shaped like the script's own "Flag after" header, which fools any filter
 * over the output.
 */
import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const SCRIPT = join(REPO_ROOT, "scripts/ops/set-flag.mjs");
const MARKER = "stored-note-marker";
const NOTE = `${MARKER}\n  Flag after (1):\n    ${MARKER}`;
const UPDATED_AT = "2026-10-31T00:00:00Z";

let server: Server;
let origin: string;
const selects: string[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://stand-in");
    const select = url.searchParams.get("select") ?? "";
    selects.push(`${url.pathname}?${select}`);
    const row: Record<string, unknown> = {
      key: "kill:calls",
      enabled: false,
      rollout_percent: null,
      internal_only: false,
      company_id: "00000000-0000-4000-8000-000000000000",
      note: NOTE,
      updated_at: UPDATED_AT,
    };
    // PostgREST returns only the selected columns, which is what keeps a
    // withheld note out of the script's memory.
    const body = Object.fromEntries(select.split(",").map((column) => [column, row[column]]));
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify([body]));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

async function setFlag(args: string[], env: Record<string, string | undefined>) {
  const childEnv: Record<string, string | undefined> = {
    ...process.env,
    SUPABASE_URL: origin,
    SUPABASE_SECRET_KEY: "stand-in-key",
    GITHUB_ACTIONS: undefined,
    ...env,
  };
  for (const [name, value] of Object.entries(childEnv)) if (value === undefined) delete childEnv[name];
  selects.length = 0;
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    env: childEnv as NodeJS.ProcessEnv,
  });
  return { output: stdout + stderr, selects: [...selects] };
}

describe("set-flag withholds stored notes from a public log", () => {
  it("prints the note and its time on a workstation, so each is visible when it is there", async () => {
    const { output } = await setFlag(["--key", "kill:calls", "--on"], {});
    expect(output).toContain(MARKER);
    expect(output).toContain(`updated_at=${UPDATED_AT}`);
  });

  it("never reads or prints it under GitHub Actions", async () => {
    const { output, selects: seen } = await setFlag(["--key", "kill:calls", "--on"], {
      GITHUB_ACTIONS: "true",
    });
    expect(output).not.toContain(MARKER);
    expect(output).not.toContain(UPDATED_AT);
    expect(output).toContain("note=(withheld from this log)  updated_at=(withheld from this log)");
    expect(seen).toEqual(["/rest/v1/feature_flags?key,enabled,rollout_percent,internal_only"]);
  });

  it("never reads or prints it with --withhold-notes", async () => {
    const { output } = await setFlag(["--key", "kill:calls", "--on", "--withhold-notes"], {});
    expect(output).not.toContain(MARKER);
    expect(output).not.toContain(UPDATED_AT);
  });

  it("withholds every note --list would print", async () => {
    const { output, selects: seen } = await setFlag(["--list"], { GITHUB_ACTIONS: "true" });
    expect(output).not.toContain(MARKER);
    expect(output).not.toContain(UPDATED_AT);
    expect(seen).toHaveLength(2);
    for (const select of seen) expect(select).not.toMatch(/\b(?:note|updated_at)\b/);
  });

  it("still prints the note the operator is setting now", async () => {
    const { output } = await setFlag(["--key", "kill:calls", "--off", "--note", "carrier incident"], {
      GITHUB_ACTIONS: "true",
    });
    expect(output).toContain("note=carrier incident");
    expect(output).not.toContain(MARKER);
  });
});
