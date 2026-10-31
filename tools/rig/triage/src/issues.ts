/**
 * One GitHub issue per failure fingerprint, labelled `synthetic`. The
 * fingerprint is written into the body as a marker, so the same
 * failure finds its issue again: it is commented on while open and reopened if
 * it was closed, never filed twice.
 */
import { GITHUB_API, githubHeaders, splitRepo } from "./github-app.ts";
import { redactForIssue } from "./redact.ts";

export const SYNTHETIC_LABEL = "synthetic";
const PAGES = 5;

export function fingerprintMarker(fingerprint: readonly string[]): string {
  return `<!-- synthetic-fingerprint: ${fingerprint.join("/")} -->`;
}

/** `['synthetic', scenario, failure_class]` or `['synthetic-infra', component]`. */
export function isFingerprint(value: unknown): value is string[] {
  if (!Array.isArray(value) || !value.every((part) => typeof part === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(part))) {
    return false;
  }
  return (value[0] === "synthetic" && value.length === 3) || (value[0] === "synthetic-infra" && value.length === 2);
}

export interface IssueDraft {
  fingerprint: string[];
  title: string;
  /** For a new issue, its body; for an existing one, the comment. */
  body: string;
}

export interface IssueResult {
  number: number;
  url: string;
  action: "created" | "commented" | "reopened";
}

interface GithubIssue {
  number: number;
  html_url: string;
  state: "open" | "closed";
  body?: string | null;
  pull_request?: unknown;
}

export async function upsertSyntheticIssue(
  token: string,
  repo: string,
  draft: IssueDraft,
  doFetch: typeof fetch = fetch,
): Promise<IssueResult> {
  if (!isFingerprint(draft.fingerprint)) throw new Error("issues: not a synthetic fingerprint");
  const [owner, name] = splitRepo(repo);
  const base = `${GITHUB_API}/repos/${owner}/${name}`;
  const headers = { ...githubHeaders(token), "content-type": "application/json" };
  const marker = fingerprintMarker(draft.fingerprint);
  const title = redactForIssue(draft.title).replace(/\s+/g, " ").trim().slice(0, 200);
  const body = redactForIssue(draft.body);

  const existing = await findIssue(base, headers, marker, doFetch);
  if (!existing) {
    const response = await doFetch(`${base}/issues`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title, body: `${marker}\n${body}`, labels: [SYNTHETIC_LABEL] }),
    });
    if (!response.ok) throw new Error(`issues: creating returned ${response.status}`);
    const created = (await response.json()) as GithubIssue;
    return { number: created.number, url: created.html_url, action: "created" };
  }

  const reopen = existing.state === "closed";
  if (reopen) {
    const response = await doFetch(`${base}/issues/${existing.number}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ state: "open" }),
    });
    if (!response.ok) throw new Error(`issues: reopening returned ${response.status}`);
  }
  const comment = await doFetch(`${base}/issues/${existing.number}/comments`, {
    method: "POST",
    headers,
    body: JSON.stringify({ body }),
  });
  if (!comment.ok) throw new Error(`issues: commenting returned ${comment.status}`);
  return { number: existing.number, url: existing.html_url, action: reopen ? "reopened" : "commented" };
}

async function findIssue(
  base: string,
  headers: Record<string, string>,
  marker: string,
  doFetch: typeof fetch,
): Promise<GithubIssue | undefined> {
  let closed: GithubIssue | undefined;
  for (let page = 1; page <= PAGES; page++) {
    const response = await doFetch(
      `${base}/issues?labels=${SYNTHETIC_LABEL}&state=all&sort=updated&direction=desc&per_page=100&page=${page}`,
      { headers },
    );
    if (!response.ok) throw new Error(`issues: listing returned ${response.status}`);
    const issues = (await response.json()) as GithubIssue[];
    for (const issue of issues) {
      if (issue.pull_request || !issue.body?.includes(marker)) continue;
      if (issue.state === "open") return issue;
      closed ??= issue;
    }
    if (issues.length < 100) break;
  }
  return closed;
}
