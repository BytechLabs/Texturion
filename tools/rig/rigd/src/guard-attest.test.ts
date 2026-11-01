/**
 * The guard's version attestation against stub Cloudflare and GitHub servers,
 * and its reporting against a stub edge.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EDGE_PATHS } from "@loonext/rig-protocol";
import { SecretFiles } from "@loonext/rig-robot";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ATTEST_SECRETS,
  attestGuard,
  CLOUDFLARE_API,
  DEPLOY_JOB,
  DEPLOY_MESSAGE,
  DEPLOY_STEP,
  GUARD_SCRIPT,
  reportAttestation,
  type Attestation,
} from "./guard-attest.ts";

const REPO = "BytechLabs/Texturion";
const ACCOUNT = "0123456789abcdef0123456789abcdef";
const ATTEST_TOKEN = "cf-attest-test-token-0123456789";
const SHA_OLD = "1".repeat(40);
const SHA_NEW = "2".repeat(40);
const SHA_OTHER = "3".repeat(40);
const NOW = Date.parse("2026-10-31T12:00:00.000Z");
const CONTROL_TOKEN = "rig-control-test-token";

interface Seen {
  method: string;
  path: string;
  authorization?: string;
  body: string;
}

interface Stub {
  origin: string;
  seen: Seen[];
  answer: (request: Seen) => { status: number; body: unknown } | undefined;
  close(): Promise<void>;
}

async function stubServer(): Promise<Stub> {
  const stub: Stub = { origin: "", seen: [], answer: () => undefined, close: async () => undefined };
  const server: Server = createServer((request: IncomingMessage, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const seen: Seen = {
        method: request.method ?? "GET",
        path: request.url ?? "/",
        authorization: request.headers.authorization,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      stub.seen.push(seen);
      const answer = stub.answer(seen) ?? { status: 404, body: { message: "Not Found" } };
      response.writeHead(answer.status, { "content-type": "application/json" }).end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  stub.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  stub.close = () => new Promise((resolve) => server.close(() => resolve()));
  return stub;
}

let cloudflare: Stub;
let github: Stub;
let edge: Stub;
const appKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

/** Real HTTP to the stubs, for the hosts the attestation names. */
const toStubs: typeof fetch = (input, init) => {
  const url = String(input instanceof Request ? input.url : input)
    .replace(CLOUDFLARE_API.replace(/\/client\/v4$/, ""), cloudflare.origin)
    .replace("https://api.github.com", github.origin);
  return fetch(url, init);
};

beforeAll(async () => {
  [cloudflare, github, edge] = await Promise.all([stubServer(), stubServer(), stubServer()]);
});
afterAll(async () => {
  await Promise.all([cloudflare, github, edge].map((stub) => stub.close()));
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const stub of [cloudflare, github, edge]) {
    stub.seen.length = 0;
    stub.answer = () => undefined;
  }
});

function storeWith(omit: string[] = []): SecretFiles {
  const dir = mkdtempSync(join(tmpdir(), "rigd-attest-"));
  dirs.push(dir);
  const store = new SecretFiles(dir);
  const values: Record<string, string> = {
    [ATTEST_SECRETS.token]: ATTEST_TOKEN,
    [ATTEST_SECRETS.account]: ACCOUNT,
    [ATTEST_SECRETS.appId]: "123456",
    [ATTEST_SECRETS.appKey]: appKey,
  };
  for (const [name, value] of Object.entries(values)) if (!omit.includes(name)) store.write(name, value);
  return store;
}

interface RunSpec {
  id: number;
  sha: string;
  event: "push" | "workflow_dispatch" | "schedule";
  created_at: string;
  /** The Deploy step, or null when the job skipped it. */
  deploy: { status: "completed" | "in_progress"; conclusion: string | null; started_at: string; completed_at: string | null } | null;
}

/** The live deployment as Cloudflare lists it, and guard.yml's runs as GitHub does. */
function serve(live: Record<string, unknown> | null, runs: RunSpec[]): void {
  cloudflare.answer = (request) => {
    if (request.path !== `/client/v4/accounts/${ACCOUNT}/workers/scripts/${GUARD_SCRIPT}/deployments`) return undefined;
    if (request.authorization !== `Bearer ${ATTEST_TOKEN}`) return { status: 403, body: { success: false, errors: [{ code: 10000 }] } };
    return { status: 200, body: { success: true, errors: [], result: { deployments: live ? [live] : [] } } };
  };
  github.answer = (request) => {
    const url = new URL(request.path, "http://github.test");
    if (url.pathname === `/repos/${REPO}/installation`) return { status: 200, body: { id: 77 } };
    if (url.pathname === "/app/installations/77/access_tokens" && request.method === "POST") {
      // A token that can read Actions, on this repository, and nothing more.
      const asked = request.body === JSON.stringify({ repositories: ["Texturion"], permissions: { actions: "read" } });
      return asked ? { status: 201, body: { token: "ghs-attest-test" } } : { status: 422, body: {} };
    }
    if (request.authorization !== "Bearer ghs-attest-test") return { status: 401, body: {} };
    if (url.pathname === `/repos/${REPO}/actions/workflows/guard.yml/runs`) {
      if (url.searchParams.get("branch") !== "main") return { status: 200, body: { workflow_runs: [] } };
      const event = url.searchParams.get("event");
      const listed = runs
        .filter((run) => run.event === event)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
        .map((run) => ({ id: run.id, head_sha: run.sha, head_branch: "main", event: run.event, created_at: run.created_at }));
      return { status: 200, body: { total_count: listed.length, workflow_runs: listed } };
    }
    const jobs = /^\/repos\/[^/]+\/[^/]+\/actions\/runs\/(\d+)\/jobs$/.exec(url.pathname);
    if (jobs) {
      const run = runs.find((candidate) => candidate.id === Number(jobs[1]));
      if (!run) return undefined;
      const steps = [
        { name: "Deploy now?", status: "completed", conclusion: "success", started_at: run.created_at, completed_at: run.created_at },
        run.deploy
          ? { name: DEPLOY_STEP, ...run.deploy }
          : { name: DEPLOY_STEP, status: "completed", conclusion: "skipped", started_at: run.created_at, completed_at: run.created_at },
      ];
      return {
        status: 200,
        body: { jobs: [{ name: "Guard policy tests", steps: [] }, { name: DEPLOY_JOB, steps }] },
      };
    }
    return undefined;
  };
}

const deployed = (sha: string, at: string, over: Record<string, unknown> = {}) => ({
  id: "dep-live-0001",
  created_on: at,
  source: "wrangler",
  strategy: "percentage",
  versions: [{ version_id: "ver-0001", percentage: 100 }],
  annotations: { "workers/message": `guard.yml ${sha}`, "workers/triggered_by": "upload" },
  ...over,
});

/** A push that deployed SHA_OLD at 09:00, and a scheduled run since, which never deploys. */
const HISTORY: RunSpec[] = [
  {
    id: 101,
    sha: SHA_OLD,
    event: "push",
    created_at: "2026-10-31T08:58:00.000Z",
    deploy: { status: "completed", conclusion: "success", started_at: "2026-10-31T09:00:00Z", completed_at: "2026-10-31T09:01:30Z" },
  },
  { id: 102, sha: SHA_OLD, event: "schedule", created_at: "2026-10-31T03:23:00.000Z", deploy: null },
];

const attest = (store = storeWith()) => attestGuard({ store, repo: REPO, fetch: toStubs, now: () => NOW });

describe("the guard's version attestation", () => {
  it("matches the live deployment guard.yml made from main, during its Deploy step", async () => {
    serve(deployed(SHA_OLD, "2026-10-31T09:01:05.000Z"), HISTORY);
    expect(await attest()).toEqual({ outcome: "match", sha: SHA_OLD, deployment_id: "dep-live-0001", run_id: 101 });
    // Only pushes and dispatches are listed; a scheduled run never deploys.
    expect(github.seen.filter((request) => request.path.includes("/runs?")).map((request) => new URL(request.path, "http://x").searchParams.get("event"))).toEqual([
      "push",
      "workflow_dispatch",
    ]);
  });

  it("counts a deploy still running, and one that failed after it may have deployed", async () => {
    const running: RunSpec = {
      id: 104,
      sha: SHA_NEW,
      event: "workflow_dispatch",
      created_at: "2026-10-31T11:55:00.000Z",
      deploy: { status: "in_progress", conclusion: null, started_at: "2026-10-31T11:56:00Z", completed_at: null },
    };
    const failed: RunSpec = {
      id: 103,
      sha: SHA_OTHER,
      event: "push",
      created_at: "2026-10-31T10:00:00.000Z",
      deploy: { status: "completed", conclusion: "failure", started_at: "2026-10-31T10:01:00Z", completed_at: "2026-10-31T10:02:00Z" },
    };
    serve(deployed(SHA_NEW, "2026-10-31T11:58:00.000Z"), [...HISTORY, running, failed]);
    expect(await attest()).toMatchObject({ outcome: "match", sha: SHA_NEW, run_id: 104 });
    serve(deployed(SHA_OTHER, "2026-10-31T10:01:40.000Z"), [...HISTORY, running, failed]);
    expect(await attest()).toMatchObject({ outcome: "match", sha: SHA_OTHER, run_id: 103 });
    serve(deployed(SHA_OLD, "2026-10-31T09:01:05.000Z"), [...HISTORY, running, failed]);
    expect(await attest()).toMatchObject({ outcome: "match", sha: SHA_OLD, run_id: 101 });
  });

  it("is a mismatch for a commit guard.yml did not deploy, a deployment made outside its step, another message, or a split", async () => {
    serve(deployed(SHA_OTHER, "2026-10-31T09:01:05.000Z"), HISTORY);
    expect(await attest()).toEqual({
      outcome: "mismatch",
      reason: `the live deployment names ${SHA_OTHER.slice(0, 12)}, but guard.yml last deployed ${SHA_OLD.slice(0, 12)} from main`,
      deployment_id: "dep-live-0001",
      expected: [SHA_OLD],
    });

    // The right message on a deployment made hours after the step: a redeploy by some other hand.
    serve(deployed(SHA_OLD, "2026-10-31T11:30:00.000Z"), HISTORY);
    expect(await attest()).toMatchObject({ outcome: "mismatch", reason: expect.stringMatching(/Cloudflare made it at 2026-10-31T11:30:00\.000Z, while no Deploy step/) });

    serve(deployed(SHA_OLD, "2026-10-31T09:01:05.000Z", { annotations: { "workers/triggered_by": "rollback" } }), HISTORY);
    expect(await attest()).toMatchObject({ outcome: "mismatch", reason: 'the live deployment dep-live-0001 was not made by guard.yml: its message is ""' });

    const split = [
      { version_id: "ver-0001", percentage: 90 },
      { version_id: "ver-0002", percentage: 10 },
    ];
    serve(deployed(SHA_OLD, "2026-10-31T09:01:05.000Z", { versions: split }), HISTORY);
    expect(await attest()).toMatchObject({ outcome: "mismatch", reason: expect.stringMatching(/splits traffic across 2 version/) });
  });

  it("calls a side it cannot read an infrastructure fault, never a pass", async () => {
    serve(deployed(SHA_OLD, "2026-10-31T09:01:05.000Z"), HISTORY);
    const cloudflareDown = cloudflare.answer;
    cloudflare.answer = () => ({ status: 403, body: { success: false, errors: [{ code: 10000 }] } });
    expect(await attest()).toEqual({ outcome: "infra", reason: "Cloudflare's deployments API answered 403 (error 10000)" });

    cloudflare.answer = cloudflareDown;
    const githubUp = github.answer;
    github.answer = (request) => (request.path.includes("/jobs") ? { status: 502, body: {} } : githubUp(request));
    expect(await attest()).toEqual({ outcome: "infra", reason: "GitHub answered 502 for /actions/runs/101/jobs" });

    github.answer = githubUp;
    serve(null, HISTORY);
    expect(await attest()).toEqual({ outcome: "infra", reason: `Cloudflare lists no deployment of ${GUARD_SCRIPT}` });

    // A history with no successful deploy cannot say what main deployed.
    serve(deployed(SHA_OLD, "2026-10-31T09:01:05.000Z"), [{ ...HISTORY[0]!, deploy: null }]);
    expect(await attest()).toMatchObject({ outcome: "infra", reason: expect.stringMatching(/^no Deploy step of guard\.yml on main succeeded/) });
  });

  it("names a missing credential and asks nobody anything without it", async () => {
    serve(deployed(SHA_OLD, "2026-10-31T09:01:05.000Z"), HISTORY);
    expect(await attest(storeWith([ATTEST_SECRETS.token]))).toEqual({
      outcome: "infra",
      reason: "the store has no cf-guard-attest-token, so the guard's version cannot be attested",
    });
    expect(await attest(storeWith([ATTEST_SECRETS.account, ATTEST_SECRETS.appKey]))).toMatchObject({
      outcome: "infra",
      reason: expect.stringMatching(/^the store has no cloudflare-account-id, rig-app-key,/),
    });
    expect([...cloudflare.seen, ...github.seen]).toEqual([]);
  });
});

describe("reporting an attestation", () => {
  const mismatch: Attestation = {
    outcome: "mismatch",
    reason: "the live deployment names 333333333333, but guard.yml last deployed 111111111111 from main",
    deployment_id: "dep-live-0001",
    expected: [SHA_OLD],
  };

  function reporting(controlToken: string | undefined) {
    const infra: string[] = [];
    const lines: string[] = [];
    return {
      infra,
      lines,
      options: { edgeOrigin: edge.origin, controlToken, infra: async (message: string) => void infra.push(message), log: (line: string) => lines.push(line) },
    };
  }

  it("raises a mismatch in production through the edge, as ops/telnyx-guard-integrity", async () => {
    edge.answer = (request) => (request.path === EDGE_PATHS.ctlAlert ? { status: 200, body: { sent: true } } : undefined);
    const { options, infra } = reporting(CONTROL_TOKEN);
    expect(await reportAttestation(mismatch, options)).toBe("alerted");
    expect(edge.seen).toHaveLength(1);
    expect(edge.seen[0]).toMatchObject({ method: "POST", path: EDGE_PATHS.ctlAlert, authorization: `Bearer ${CONTROL_TOKEN}` });
    const body = JSON.parse(edge.seen[0]!.body) as { key: string; message: string; detail: string };
    expect(body.key).toBe("telnyx-guard-integrity");
    expect(body.detail).toContain(mismatch.reason);
    expect(body.detail).toContain(SHA_OLD);
    expect(infra).toEqual([]);
  });

  it("reports a mismatch the edge did not take, and every fault, to the synthetic project", async () => {
    edge.answer = () => ({ status: 503, body: { error: "no_production_dsn" } });
    const first = reporting(CONTROL_TOKEN);
    expect(await reportAttestation(mismatch, first.options)).toBe("infra");
    expect(first.infra).toEqual([`mismatch (${mismatch.reason}), and the edge did not take the production alert: 503`]);

    const tokenless = reporting(undefined);
    expect(await reportAttestation(mismatch, tokenless.options)).toBe("infra");
    expect(tokenless.infra[0]).toMatch(/did not take the production alert: no control token$/);

    const fault = reporting(CONTROL_TOKEN);
    expect(await reportAttestation({ outcome: "infra", reason: "GitHub answered 502 for /actions/runs/101/jobs" }, fault.options)).toBe("infra");
    expect(fault.infra).toEqual(["GitHub answered 502 for /actions/runs/101/jobs"]);

    const quiet = reporting(CONTROL_TOKEN);
    edge.seen.length = 0;
    expect(await reportAttestation({ outcome: "match", sha: SHA_OLD, deployment_id: "d", run_id: 1 }, quiet.options)).toBe("none");
    expect([quiet.infra, quiet.lines, edge.seen]).toEqual([[], [], []]);
  });
});

describe("guard.yml, as the attestation reads it", () => {
  const workflow = readFileSync(fileURLToPath(new URL("../../../../.github/workflows/guard.yml", import.meta.url)), "utf8");

  it("names the job and step the attestation looks for", () => {
    expect(workflow).toContain(`    name: ${DEPLOY_JOB}\n`);
    expect(workflow).toMatch(new RegExp(`- name: ${DEPLOY_STEP}\\n\\s+if: steps\\.token\\.outputs\\.deploy == 'true'`));
  });

  it("puts the commit in every deployment's message, in the form the attestation parses", () => {
    const messages = [...workflow.matchAll(/--message "([^"]+)"/g)].map((match) => match[1]!);
    expect(messages).toEqual(["guard.yml ${GITHUB_SHA}"]);
    expect(DEPLOY_MESSAGE.exec(messages[0]!.replace("${GITHUB_SHA}", SHA_OLD))?.[1]).toBe(SHA_OLD);
    // One wrangler deploy, inside the function both attempts call, the
    // fallback without the edge binding included.
    expect(workflow.match(/wrangler deploy/g)).toHaveLength(1);
    expect(workflow).toMatch(/exec wrangler deploy \\\n\s+--message "guard\.yml \$\{GITHUB_SHA\}"/);
  });
});
