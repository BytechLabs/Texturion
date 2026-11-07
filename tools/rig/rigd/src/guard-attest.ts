/**
 * The guard version attestation R00 runs (docs/RIG.md): is the guard
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
 * every Deploy step of guard.yml on main that ran, newest first, down to the
 * newest one that succeeded: a step that failed or was cancelled may have
 * deployed before it stopped, and one still running may be deploying now.
 * Steps are ordered by when they started, not by their run, because
 * re-running an older run (a rollback) keeps that run's id and creation
 * time. A scheduled run never deploys, so only pushes and dispatches are read.
 *
 * The live deployment matches when it serves one version, its message names
 * one of those runs' commit, and Cloudflare made it while that run's Deploy
 * step ran. Anything else is a mismatch. A side that cannot be read is an
 * infrastructure fault, never a pass, and so is a missing credential.
 *
 * A secret change, which is how the founder pastes the guard's vendor keys
 * (docs/RIG.md FA3, FA6 and FA8), redeploys the live code with no message, so
 * it is read through to the deployment it replaced, which must match.
 * Cloudflare takes that label from whoever creates a deployment, and the read
 * token cannot see a version's code (Get Version needs content read), so a
 * secret change is taken at its word: only a holder of the guard's deploy
 * rights could put other code under one.
 */
import type { SecretFiles } from "@loonext/rig-robot";
import { githubHeaders, GITHUB_API, installationToken, splitRepo } from "@loonext/rig-triage";

export const GUARD_SCRIPT = "loonext-telnyx-guard";
export const GUARD_WORKFLOW = "guard.yml";
/** guard.yml's deploy job and its step, by the names Actions reports. */
export const DEPLOY_JOB = "Deploy loonext-telnyx-guard";
export const DEPLOY_STEP = "Deploy";
export const DEPLOY_MESSAGE = /^guard\.yml ([0-9a-f]{40})$/;
/** `workers/triggered_by` on what `wrangler secret put` and the dashboard's secret Deploy make. */
export const SECRET_CHANGE = "secret";
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

export interface Deployment {
  id: string;
  created_on: string;
  message: string | null;
  triggered_by: string | null;
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
  | { outcome: "match"; sha: string; deployment_id: string; run_id: number; secret_changes: number }
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

/** The repository whose guard.yml is attested, and whose issues triage files; RIG_REPO names another. */
export function rigRepo(env: NodeJS.ProcessEnv): string {
  return env.RIG_REPO ?? "BytechLabs/Texturion";
}

export async function attestGuard(options: AttestOptions): Promise<Attestation> {
  const { store } = options;
  const missing = Object.values(ATTEST_SECRETS).filter((name) => !store.readOptional(name));
  if (missing.length > 0) {
    return { outcome: "infra", reason: `the store has no ${missing.join(", ")}, so the guard's version cannot be attested` };
  }
  const doFetch = options.fetch ?? fetch;
  const now = (options.now ?? Date.now)();
  try {
    const history = await deployments(doFetch, store.readOptional(ATTEST_SECRETS.account)!, store.readOptional(ATTEST_SECRETS.token)!);
    const deploys = await mainDeploys(doFetch, {
      appId: store.readOptional(ATTEST_SECRETS.appId)!,
      privateKey: store.readOptional(ATTEST_SECRETS.appKey)!,
      repo: options.repo,
    });
    return compare(history, deploys, now);
  } catch (error) {
    if (error instanceof Unreadable) return { outcome: "infra", reason: error.message };
    return { outcome: "infra", reason: `the attestation failed: ${error instanceof Error ? error.message : "error"}` };
  }
}

/** `history` is Cloudflare's, newest first: the live deployment, then the ones it replaced. */
export function compare(history: Deployment[], deploys: MainDeploy[], now: number): Attestation {
  const expected = [...new Set(deploys.map((deploy) => deploy.sha))];
  const secretChanges = history.findIndex((deployment) => !isSecretChange(deployment));
  if (secretChanges === -1) {
    return { outcome: "infra", reason: `Cloudflare lists only secret changes of ${GUARD_SCRIPT}, not the deployment under them` };
  }
  const base = history[secretChanges]!;
  const subject = secretChanges === 0 ? "the live deployment" : `the deployment under the live secret change${secretChanges > 1 ? "s" : ""}`;
  const mismatch = (reason: string): Attestation => ({ outcome: "mismatch", reason, deployment_id: base.id, expected });
  if (base.versions.length !== 1 || base.versions[0]!.percentage !== 100) {
    return mismatch(`${subject} ${base.id} splits traffic across ${base.versions.length} version(s); guard.yml deploys one`);
  }
  const sha = DEPLOY_MESSAGE.exec(base.message ?? "")?.[1];
  if (!sha) {
    return mismatch(`${subject} ${base.id} was not made by guard.yml: its message is ${JSON.stringify(clip(base.message ?? "", 120))}`);
  }
  const named = deploys.filter((deploy) => deploy.sha === sha);
  if (named.length === 0) {
    return mismatch(`${subject} names ${sha.slice(0, 12)}, but guard.yml last deployed ${expected.map((s) => s.slice(0, 12)).join(", ")} from main`);
  }
  const created = Date.parse(base.created_on);
  const during = named.find(
    (deploy) =>
      created >= Date.parse(deploy.started_at) - CLOCK_SLACK_MS &&
      created <= (deploy.completed_at === null ? now : Date.parse(deploy.completed_at)) + CLOCK_SLACK_MS,
  );
  if (!during) {
    return mismatch(
      `${subject} names ${sha.slice(0, 12)}, but Cloudflare made it at ${base.created_on}, while no Deploy step of guard.yml for that commit ran`,
    );
  }
  return { outcome: "match", sha, deployment_id: history[0]!.id, run_id: during.run_id, secret_changes: secretChanges };
}

/** A split is no plain secret change, so it is attested itself. */
function isSecretChange(deployment: Deployment): boolean {
  return deployment.triggered_by === SECRET_CHANGE && deployment.versions.length === 1 && deployment.versions[0]!.percentage === 100;
}

async function deployments(doFetch: typeof fetch, account: string, token: string): Promise<Deployment[]> {
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
  const listed = Array.isArray(body.result?.deployments) ? (body.result.deployments as Record<string, unknown>[]) : [];
  if (listed.length === 0) throw new Unreadable(`Cloudflare lists no deployment of ${GUARD_SCRIPT}`);
  return listed.map((deployment) => {
    const annotations = (deployment.annotations ?? {}) as Record<string, unknown>;
    const versions = Array.isArray(deployment.versions) ? (deployment.versions as Record<string, unknown>[]) : [];
    if (typeof deployment.id !== "string" || typeof deployment.created_on !== "string" || !Number.isFinite(Date.parse(deployment.created_on))) {
      throw new Unreadable(`Cloudflare lists a deployment of ${GUARD_SCRIPT} with no id or creation time`);
    }
    return {
      id: deployment.id,
      created_on: deployment.created_on,
      message: typeof annotations["workers/message"] === "string" ? annotations["workers/message"] : null,
      triggered_by: typeof annotations["workers/triggered_by"] === "string" ? annotations["workers/triggered_by"] : null,
      versions: versions.map((version) => ({ version_id: String(version.version_id), percentage: Number(version.percentage) })),
    };
  });
}

interface Run {
  id: number;
  head_sha: string;
  head_branch: string;
  status: string;
  updated_at: string;
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
  runs.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || b.id - a.id);

  const deploys: MainDeploy[] = [];
  let newestSuccess = -Infinity;
  for (const run of runs) {
    // No step of a finished run started after the run's last update, so one
    // last updated before the newest successful Deploy has nothing to add.
    if (run.status === "completed" && Date.parse(run.updated_at) < newestSuccess) continue;
    // filter=all lists every attempt's jobs, a re-run's among them.
    const { jobs } = await get<{ jobs?: { name: string; steps?: Step[] }[] }>(`/actions/runs/${run.id}/jobs?filter=all&per_page=100`);
    const steps = (jobs ?? [])
      .filter((job) => job.name === DEPLOY_JOB)
      .flatMap((job) => (job.steps ?? []).filter((step) => step.name === DEPLOY_STEP && step.started_at !== null && step.conclusion !== "skipped"));
    for (const step of steps) {
      deploys.push({
        sha: run.head_sha,
        run_id: run.id,
        started_at: step.started_at!,
        completed_at: step.status === "in_progress" ? null : step.completed_at,
        conclusion: step.conclusion,
      });
      if (step.conclusion === "success") newestSuccess = Math.max(newestSuccess, Date.parse(step.started_at!));
    }
  }
  if (newestSuccess === -Infinity) {
    throw new Unreadable(`no Deploy step of ${GUARD_WORKFLOW} on main succeeded in its newest ${RUNS_READ} pushes and ${RUNS_READ} dispatches`);
  }
  return deploys
    .filter((deploy) => Date.parse(deploy.started_at) >= newestSuccess)
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
