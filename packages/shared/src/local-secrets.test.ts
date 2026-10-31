import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

/**
 * These pin what `scripts/check-local-secrets.mjs` reads as a live secret,
 * that placeholders and the Supabase CLI's published local key pass, that
 * `--all` is what reaches a gitignored `.dev.vars`, and that nothing it prints
 * carries the matched text.
 *
 * Every secret-shaped fixture is assembled at run time from a readable stem,
 * so this file holds nothing a secret scanner would stop.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = join(REPO, "scripts", "check-local-secrets.mjs");

type Found = { shape: string; count: number };
type Counts = { committable: number; ignored: number; skipped: number };
const guard = (await import(join(REPO, "scripts", "check-local-secrets.mjs"))) as {
  SHAPES: { name: string; pattern: RegExp }[];
  ALLOWED: Record<string, Record<string, number>>;
  PUBLISHED_LOCAL_KEYS: Set<string>;
  findShapes: (text: string) => Found[];
  judge: (
    result: {
      findings: { file: string; ignored: boolean; shapes: Found[] }[];
      read: Set<string>;
    },
    allowed?: Record<string, Record<string, number>>,
  ) => string[];
  coverage: (counts: Counts) => string[];
};

const live = {
  stripe: ["sk", "live", "readablestemforthistest"].join("_"),
  restricted: ["rk", "live", "readablestemforthistest"].join("_"),
  telnyx: `KEY${"ABCDEF".repeat(5)}_${"readablestem"}`,
  supabase: ["sb", "secret", "readable-stem-for-this-test"].join("_"),
  pooler:
    "postgresql://postgres.projectrefstem:" + "stem-password-for-a-test" + "@aws-0-us-east-1.pooler." +
    "supabase.com:5432/postgres",
};

const shapesOf = (text: string) => guard.findShapes(text).map((found) => found.shape);

describe("what it reads as a live secret", () => {
  it.each([
    ["stripe-live-secret-key", live.stripe],
    ["stripe-live-restricted-key", live.restricted],
    ["telnyx-v2-key", live.telnyx],
    ["supabase-secret-key", live.supabase],
    ["pooler-url-with-password", live.pooler],
  ])("reads %s", (shape, value) => {
    expect(shapesOf(`STRIPE_OR_WHATEVER=${value}\n`)).toEqual([shape]);
    expect(shapesOf(`const value = "${value}";`)).toEqual([shape]);
  });

  it("names five shapes, and every one is exercised above", () => {
    expect(guard.SHAPES.map((shape) => shape.name).sort()).toEqual([
      "pooler-url-with-password",
      "stripe-live-restricted-key",
      "stripe-live-secret-key",
      "supabase-secret-key",
      "telnyx-v2-key",
    ]);
  });

  it("counts each occurrence", () => {
    expect(guard.findShapes(`${live.stripe}\n${live.stripe}\n${live.supabase}`)).toEqual([
      { shape: "stripe-live-secret-key", count: 2 },
      { shape: "supabase-secret-key", count: 1 },
    ]);
  });

  it("reads a direct database host as well as the pooler", () => {
    const direct = "postgres://postgres:" + "stem-password-for-a-test" + "@db.projectrefstem." + "supabase.co:5432/postgres";
    expect(shapesOf(direct)).toEqual(["pooler-url-with-password"]);
  });
});

describe("what it reads through escapes", () => {
  const everyKey = [live.stripe, live.restricted, live.telnyx, live.supabase, live.pooler].join("\n");
  const allFive = [
    "pooler-url-with-password",
    "stripe-live-restricted-key",
    "stripe-live-secret-key",
    "supabase-secret-key",
    "telnyx-v2-key",
  ];

  it("reads every shape in a JSON string, a transcript's line", () => {
    expect(shapesOf(JSON.stringify(`${everyKey}\n`)).sort()).toEqual(allFive);
  });

  it("reads them escaped twice, as in a JSON dump of a JSON log", () => {
    expect(shapesOf(JSON.stringify(JSON.stringify(`${everyKey}\n`))).sort()).toEqual(allFive);
  });

  it("reads them URL-encoded, as in a request log or a HAR file", () => {
    expect(shapesOf(`Authorization: Bearer%20${live.stripe}`)).toEqual(["stripe-live-secret-key"]);
    expect(shapesOf(`next=${encodeURIComponent(everyKey)}`).sort()).toEqual(allFive);
  });

  it("reads them escaped as \\u sequences", () => {
    const escaped = `token\\u003d${live.supabase}`;
    expect(shapesOf(escaped)).toEqual(["supabase-secret-key"]);
  });

  it("counts a key found both as written and unescaped once", () => {
    expect(guard.findShapes(`"${live.stripe}"\\n`)).toEqual([{ shape: "stripe-live-secret-key", count: 1 }]);
  });

  it("still passes a prefix inside an identifier, escaped or not", () => {
    const buried = "FEATURE" + ["sk", "live", "readablestemforthistest"].join("_");
    expect(shapesOf(JSON.stringify(`${buried}\n`))).toEqual([]);
  });
});

describe("what passes", () => {
  it.each([
    ["the documented ellipsis", "STRIPE_SECRET_KEY=sk_live_..."],
    ["a test-mode Stripe key", ["sk", "test", "readablestemforthistest"].join("_")],
    ["a short Telnyx-looking literal", "KEY0123456789ABCDEF"],
    ["the placeholder hex run", `KEY${"0123456789ABCDEF".repeat(2)}`],
    ["a run of x", "sb_secret_" + "x".repeat(24)],
    ["a fixture that says so", ["sk", "live", "not", "a", "real", "key"].join("_")],
    ["a prefix inside an identifier", "FEATURE" + ["sk", "live", "readablestemforthistest"].join("_")],
    ["a password placeholder", "postgresql://postgres.<ref>:<password>@aws-0-us-east-1.pooler." + "supabase.com:5432/postgres"],
    ["the dashboard's placeholder", "postgresql://postgres.ref:[YOUR-PASSWORD]@aws-0-us-east-1.pooler." + "supabase.com:6543/postgres"],
    ["a template", "postgresql://postgres.${ref}:${password}@${host}:5432/postgres"],
    ["a fixture's stand-in password", "postgres://postgres:pw@aws-0-region.pooler." + "supabase.com:6543/postgres"],
    ["a local login", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"],
    ["a non-Supabase host", "postgres://postgres:secret@db.example.invalid:5432/postgres"],
  ])("passes %s", (_label, text) => {
    expect(shapesOf(text)).toEqual([]);
  });

  it("passes the Supabase CLI's published local key, and only that one", () => {
    const [published] = [...guard.PUBLISHED_LOCAL_KEYS];
    expect(shapesOf(`SUPABASE_SECRET_KEY=${published}`)).toEqual([]);
    expect(shapesOf(`SUPABASE_SECRET_KEY=${published.slice(0, -1)}Q`)).toEqual(["supabase-secret-key"]);
  });
});

describe("the allowance for published vendor examples", () => {
  const read = new Set(["telnyx-spec3.json", "docs/runbook.md"]);
  const spec = { file: "telnyx-spec3.json", ignored: false, shapes: [{ shape: "telnyx-v2-key", count: 1 }] };

  it("excuses exactly the allowed count", () => {
    expect(guard.judge({ findings: [spec], read })).toEqual([]);
  });

  it("fails one more than allowed", () => {
    const failures = guard.judge({
      findings: [{ ...spec, shapes: [{ shape: "telnyx-v2-key", count: 2 }] }],
      read,
    });
    expect(failures.join("\n")).toMatch(/telnyx-spec3\.json: telnyx-v2-key \(2, 1 allowed\)/);
  });

  it("fails an allowance nothing uses any more, so it cannot go stale", () => {
    expect(guard.judge({ findings: [], read }).join("\n")).toMatch(/delete the entry/);
    expect(guard.judge({ findings: [], read: new Set() }).join("\n")).toMatch(/not read/);
  });

  it("never excuses a gitignored file, whatever its name", () => {
    const failures = guard.judge({ findings: [{ ...spec, ignored: true }], read });
    expect(failures.join("\n")).toMatch(/\[gitignored\]/);
  });
});

it("fails when it read nothing, since a blind reader passes everything", () => {
  expect(guard.coverage({ committable: 3, ignored: 0, skipped: 0 })).toEqual([]);
  expect(guard.coverage({ committable: 0, ignored: 0, skipped: 4 }).join("\n")).toMatch(/reading nothing/);
});

describe("on a checkout", () => {
  let root: string | null = null;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = null;
  });

  function checkout(files: Record<string, string | Buffer>) {
    root = mkdtempSync(join(tmpdir(), "local-secrets-"));
    spawnSync("git", ["init", "-q"], { cwd: root });
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    // The vendored spec the allowance names, so the allowance is in use.
    writeFileSync(join(root, "telnyx-spec3.json"), JSON.stringify({ example: live.telnyx }));
    return root;
  }

  const run = (dir: string, ...args: string[]) => {
    const result = spawnSync(process.execPath, [SCRIPT, "--root", dir, ...args], { encoding: "utf8" });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  };

  it("passes a clean checkout and says how much it read", { timeout: 60_000 }, () => {
    const dir = checkout({ "README.md": "nothing here\n", ".gitignore": ".dev.vars\n" });
    const { status, output } = run(dir);
    expect(status).toBe(0);
    expect(output).toMatch(/no live-secret shape in 3 committable files/);
  });

  it("refuses a committable file, naming the file and shape and never the secret", { timeout: 60_000 }, () => {
    const dir = checkout({
      ".gitignore": ".dev.vars\n",
      "docs/runbook.md": `paste this: ${live.supabase}\nand ${live.pooler}\n`,
    });
    const { status, output } = run(dir);
    expect(status).toBe(1);
    expect(output).toContain("docs/runbook.md: supabase-secret-key (1), pooler-url-with-password (1)");
    for (const value of [live.supabase, live.pooler, "stem-password-for-a-test", "readable-stem-for-this-test"]) {
      expect(output).not.toContain(value);
    }
  });

  it("refuses a key in a transcript, a request log, a UTF-16 file and a binary", { timeout: 60_000 }, () => {
    const byteOrderMark = String.fromCharCode(0xfeff);
    const utf16 = (text: string) => Buffer.from(`${byteOrderMark}${text}`, "utf16le");
    const dir = checkout({
      "transcript.jsonl": `${JSON.stringify({ text: `${live.supabase}\n${live.telnyx}\n` })}\n`,
      "har.txt": `Bearer%20${live.stripe}\n`,
      "notes-utf16.txt": utf16(`SUPABASE_SECRET_KEY=${live.supabase}\r\n`),
      "notes-utf16-nobom.txt": Buffer.from(`STRIPE=${live.restricted}\r\n`, "utf16le"),
      "blob.dat": Buffer.concat([Buffer.from([0, 1, 2, 0]), Buffer.from(` ${live.stripe} `), Buffer.from([0, 0])]),
    });
    const { status, output } = run(dir);
    expect(status).toBe(1);
    expect(output).toContain("transcript.jsonl: telnyx-v2-key (1), supabase-secret-key (1)");
    expect(output).toContain("har.txt: stripe-live-secret-key (1)");
    expect(output).toContain("notes-utf16.txt: supabase-secret-key (1)");
    expect(output).toContain("notes-utf16-nobom.txt: stripe-live-restricted-key (1)");
    expect(output).toContain("blob.dat: stripe-live-secret-key (1)");
    expect(output).toMatch(/2 decoded from UTF-16; 1 binary read for their ASCII runs/);
    for (const value of Object.values(live)) expect(output).not.toContain(value);
  });

  it("reaches a gitignored .dev.vars only with --all, commented lines included", { timeout: 60_000 }, () => {
    const dir = checkout({
      ".gitignore": ".dev.vars\nnode_modules/\n.claude/worktrees/\n",
      ".dev.vars": `LOCAL_DEV=1\n# STRIPE_SECRET_KEY=${live.stripe}\n`,
      "node_modules/pkg/fixture.txt": live.stripe,
      // Another checkout nested under an ignored path is read by its own run.
      ".claude/worktrees/agent/.git": "gitdir: elsewhere\n",
      ".claude/worktrees/agent/notes.md": live.stripe,
    });
    expect(run(dir).status).toBe(0);
    const all = run(dir, "--all");
    expect(all.status).toBe(1);
    expect(all.output).toContain(".dev.vars [gitignored]: stripe-live-secret-key (1)");
    expect(all.output).not.toContain("node_modules");
    expect(all.output).not.toContain(".claude/worktrees");
    expect(all.output).not.toContain(live.stripe);
  });
});
