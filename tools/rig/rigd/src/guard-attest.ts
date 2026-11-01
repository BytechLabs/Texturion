/**
 * The hourly guard version attestation (docs/RIG.md): is the guard
 * Cloudflare serves the one guard.yml last deployed from main?
 *
 * Cloudflare's side is the guard's live deployment, read with the
 * guard-attest-read token: GET /accounts/<id>/workers/scripts/
 * loonext-telnyx-guard/deployments, whose first entry is the one serving
 * traffic. guard.yml deploys with `wrangler deploy --message "guard.yml
 * <sha>"`, and wrangler puts that message on the deployment as well as the
 * version.
 *
 * GitHub's side is guard.yml's own run history, read with a token of the
 * rig's App limited to reading Actions. "The last deployment from main" is
 * every run of guard.yml on main, newest first, whose Deploy step ran, down
 * to the newest one whose Deploy step succeeded: a step that failed may have
 * deployed before it failed, and one still running may be deploying now. A
 * scheduled run never deploys, so only pushes and dispatches are read.
 *
 * The live deployment matches when it serves one version, its message names
 * one of those runs' commit, and Cloudflare made it while that run's Deploy
 * step ran. Anything else is a mismatch. A side that cannot be read is an
 * infrastructure fault, never a pass, and so is a missing credential.
 */
import { EDGE_PATHS, type RigAlert } from "@loonext/rig-protocol";
import type { SecretFiles } from "@loonext/rig-robot";
import { githubHeaders, GITHUB_API, installationToken, splitRepo } from "@loonext/rig-triage";

export const GUARD_SCRIPT = "loonext-telnyx-guard";
export const GUARD_WORKFLOW = "guard.yml";
/** guard.yml's deploy job and its step, by the names Actions reports. */
export const DEPLOY_JOB = "Deploy loonext-telnyx-guard";
export const DEPLOY_STEP = "Deploy";
export const DEPLOY_MESSAGE = /^guard\.yml ([0-9a-f]{40})$/;
export const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

export const ATTEST_SECRETS = {
  token: "cf-guard-attest-token",
  account: "cloudflare-account-id",
  appId: "rig-app-id",
  appKey: "rig-app-key",
} as const;

/** GitHub and Cloudflare stamp times on different clocks, to the second. */
const CLOCK_SLACK_MS = 2 * 60_000;
/** Pushes and dispatches read, each, before the history counts as unreadable. */
const RUNS_READ = 30;

export interface LiveDeployment {
  id: string;
  created_on: string;
  message: string | null;
  versions: { version_id: string; percentage: number }[];
}

/** One time guard.yml's Deploy step ran on main. */
export interface MainDeploy {
  sha: string;
  run_id: number;
  started_at: string;
  /** Null while the step is still running. */
  completed_at: string | null;
  conclusion: string | null;
}

export type Attestation =
  | { outcome: "match"; sha: string; deployment_id: string; run_id: number }
  | { outcome: "mismatch"; reason: string; deployment_id: string; expected: string[] }
  | { outcome: "infra"; reason: string };

export interface AttestOptions {
  store: Pick<SecretFiles, "readOptional">;
  /** owner/name */
  repo: string;
  fetch?: typeof fetch;
  now?: () => number;
}

class Unreadable extends Error {}

export async function attestGuard(options: AttestOptions): Promise<Attestation> {
  const { store } = options;
  const missing = Object.values(ATTEST_SECRETS).filter((name) => !store.readOptional(name));
  if (missing.length > 0) {
    return { outcome: "infra", reason: `the store has no ${missing.join(", ")}, so the guard's version cannot be attested` };
  }
  const doFetch = options.fetch ?? fetch;
  const now = (options.now ?? Date.now)();
  try {
    const live = await liveDeployment(doFetch, store.readOptional(ATTEST_SECRETS.account)!, store.readOptional(ATTEST_SECRETS.token)!);
    const deploys = await mainDeploys(doFetch, {
      appId: store.readOptional(ATTEST_SECRETS.appId)!,
      privateKey: store.readOptional(ATTEST_SECRETS.appKey)!,
      repo: options.repo,
    });
    return compare(live, deploys, now);
  } catch (error) {
    if (error instanceof Unreadable) return { outcome: "infra", reason: error.message };
    return { outcome: "infra", reason: `the attestation failed: ${error instanceof Error ? error.message : "error"}` };
  }
}

export function compare(live: LiveDeployment, deploys: MainDeploy[], now: number): Attestation {
  const expected = [...new Set(deploys.map((deploy) => deploy.sha))];
  const mismatch = (reason: string): Attestation => ({ outcome: "mismatch", reason, deployment_id: live.id, expected });
  if (live.versions.length !== 1 || live.versions[0]!.percentage !== 100) {
    return mismatch(`the live deployment ${live.id} splits traffic across ${live.versions.length} version(s); guard.yml deploys one`);
  }
  const sha = DEPLOY_MESSAGE.exec(live.message ?? "")?.[1];
  if (!sha) {
    return mismatch(`the live deployment ${live.id} was not made by guard.yml: its message is ${JSON.stringify(clip(live.message ?? "", 120))}`);
  }
  const named = deploys.filter((deploy) => deploy.sha === sha);
  if (named.length === 0) {
    return mismatch(`the live deployment names ${sha.slice(0, 12)}, but guard.yml last deployed ${expected.map((s) => s.slice(0, 12)).join(", ")} from main`);
  }
  const created = Date.parse(live.created_on);
  const during = named.find(
    (deploy) =>
      created >= Date.parse(deploy.started_at) - CLOCK_SLACK_MS &&
      created <= (deploy.completed_at === null ? now : Date.parse(deploy.completed_at)) + CLOCK_SLACK_MS,
  );
  if (!during) {
    return mismatch(
      `the live deployment names ${sha.slice(0, 12)}, but Cloudflare made it at ${live.created_on}, while no Deploy step of guard.yml for that commit ran`,
    );
  }
  return { outcome: "match", sha, deployment_id: live.id, run_id: during.run_id };
}

async function liveDeployment(doFetch: typeof fetch, account: string, token: string): Promise<LiveDeployment> {
  if (!/^[0-9a-f]{32}$/.test(account)) throw new Unreadable("cloudflare-account-id is not a Cloudflare account id");
  const response = await doFetch(`${CLOUDFLARE_API}/accounts/${account}/workers/scripts/${GUARD_SCRIPT}/deployments`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  }).catch((error: unknown) => {
    throw new Unreadable(`Cloudflare's deployments API did not answer: ${error instanceof Error ? error.message : "error"}`);
  });
  const body = (await response.json().catch(() => null)) as {
    success?: unknown;
    errors?: { code?: unknown }[];
    result?: { deployments?: unknown };
  } | null;
  if (!response.ok || body?.success !== true) {
    const code = body?.errors?.[0]?.code;
    throw new Unreadable(`Cloudflare's deployments API answered ${response.status}${typeof code === "number" ? ` (error ${code})` : ""}`);
  }
  const first = Array.isArray(body.result?.deployments) ? (body.result.deployments[0] as Record<string, unknown> | undefined) : undefined;
  if (!first) throw new Unreadable(`Cloudflare lists no deployment of ${GUARD_SCRIPT}`);
  const annotations = (first.annotations ?? {}) as Record<string, unknown>;
  const versions = Array.isArray(first.versions) ? (first.versions as Record<string, unknown>[]) : [];
  if (typeof first.id !== "string" || typeof first.created_on !== "string" || !Number.isFinite(Date.parse(first.created_on))) {
    throw new Unreadable("Cloudflare's live deployment has no id or creation time");
  }
  return {
    id: first.id,
    created_on: first.created_on,
    message: typeof annotations["workers/message"] === "string" ? annotations["workers/message"] : null,
    versions: versions.map((version) => ({ version_id: String(version.version_id), percentage: Number(version.percentage) })),
  };
}

interface Run {
  id: number;
  head_sha: string;
  head_branch: string;
  created_at: string;
}

interface Step {
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
}

async function mainDeploys(doFetch: typeof fetch, app: { appId: string; privateKey: string; repo: string }): Promise<MainDeploy[]> {
  const [owner, name] = splitRepo(app.repo);
  const token = await installationToken(app, { fetch: doFetch, permissions: { actions: "read" } }).catch((error: unknown) => {
    throw new Unreadable(`the rig's GitHub App could not read Actions: ${error instanceof Error ? error.message : "error"}`);
  });
  const get = async <T>(path: string): Promise<T> => {
    const response = await doFetch(`${GITHUB_API}/repos/${owner}/${name}${path}`, {
      headers: githubHeaders(token),
      signal: AbortSignal.timeout(20_000),
    }).catch((error: unknown) => {
      throw new Unreadable(`GitHub did not answer: ${error instanceof Error ? error.message : "error"}`);
    });
    if (!response.ok) throw new Unreadable(`GitHub answered ${response.status} for ${path.split("?")[0]}`);
    return (await response.json()) as T;
  };

  const runs: Run[] = [];
  for (const event of ["push", "workflow_dispatch"]) {
    const page = await get<{ workflow_runs?: Run[] }>(
      `/actions/workflows/${GUARD_WORKFLOW}/runs?branch=main&event=${event}&per_page=${RUNS_READ}&exclude_pull_requests=true`,
    );
    runs.push(...(page.workflow_runs ?? []).filter((run) => run.head_branch === "main"));
  }
  runs.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);

  const deploys: MainDeploy[] = [];
  for (const run of runs) {
    const { jobs } = await get<{ jobs?: { name: string; steps?: Step[] }[] }>(`/actions/runs/${run.id}/jobs?filter=all&per_page=100`);
    const steps = (jobs ?? [])
      .filter((job) => job.name === DEPLOY_JOB)
      .flatMap((job) => (job.steps ?? []).filter((step) => step.name === DEPLOY_STEP && step.started_at !== null))
      .filter((step) => step.status === "in_progress" || step.conclusion === "success" || step.conclusion === "failure");
    for (const step of steps) {
      deploys.push({
        sha: run.head_sha,
        run_id: run.id,
        started_at: step.started_at!,
        completed_at: step.status === "in_progress" ? null : step.completed_at,
        conclusion: step.conclusion,
      });
    }
    if (steps.some((step) => step.conclusion === "success")) return deploys;
  }
  throw new Unreadable(
    `no Deploy step of ${GUARD_WORKFLOW} on main succeeded in its newest ${RUNS_READ} pushes and ${RUNS_READ} dispatches`,
  );
}

export interface AttestReporting {
  edgeOrigin: string;
  controlToken: string | undefined;
  /** A `['synthetic-infra', 'guard-attest']` event; absent while the relay is off. */
  infra?: (message: string) => Promise<unknown>;
  fetch?: typeof fetch;
  log: (line: string) => void;
}

/**
 * A mismatch goes to production through the edge, which holds the DSN the
 * box does not (EDGE_PATHS.ctlAlert). A fault, and a mismatch the edge did
 * not take, go to the synthetic project instead, so neither passes unseen.
 */
export async function reportAttestation(result: Attestation, reporting: AttestReporting): Promise<"none" | "alerted" | "infra"> {
  const infra = async (message: string) => {
    reporting.log(`guard attestation: ${message}`);
    await reporting.infra?.(message);
    return "infra" as const;
  };
  if (result.outcome === "match") return "none";
  if (result.outcome === "infra") return infra(result.reason);
  const alert: RigAlert = {
    key: "telnyx-guard-integrity",
    message: "The Telnyx guard's live deployment is not one guard.yml made from main",
    detail: clip(
      `${result.reason}. guard.yml's latest deployments from main: ${result.expected.slice(0, 5).join(", ") || "none"}. ` +
        `Find who deployed ${result.deployment_id} and how, then dispatch guard.yml from main to put the tested guard back.`,
      1_900,
    ),
  };
  let status: number | string = "no control token";
  if (reporting.controlToken) {
    status = await (reporting.fetch ?? fetch)(`${reporting.edgeOrigin}${EDGE_PATHS.ctlAlert}`, {
      method: "POST",
      headers: { authorization: `Bearer ${reporting.controlToken}`, "content-type": "application/json" },
      body: JSON.stringify(alert),
      signal: AbortSignal.timeout(20_000),
    }).then(
      async (response) => {
        await response.body?.cancel();
        return response.ok ? 200 : response.status;
      },
      () => "no answer",
    );
  }
  if (status === 200) {
    reporting.log(`guard attestation: mismatch, raised in production as ops/${alert.key}: ${result.reason}`);
    return "alerted";
  }
  return infra(`mismatch (${result.reason}), and the edge did not take the production alert: ${status}`);
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
