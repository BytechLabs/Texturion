#!/usr/bin/env node
/**
 * One GitHub issue per failing scheduled job.
 *
 *   node scripts/report-scheduled-failures.mjs            # in Actions, on workflow_run
 *   node scripts/report-scheduled-failures.mjs --dry-run  # print the plan, write nothing
 *
 * Run by `.github/workflows/scheduled-failures.yml` after every completed run of a
 * workflow with a schedule.
 *
 * A NEW failing job has to be its own signal, and a known one must not be
 * repeated every week, or the next new one gets scrolled past with it (D140).
 * So, per job, and only for scheduled or manually started runs of the default
 * branch:
 *
 *   * a failing job with no open issue gets one. That is the one notification;
 *   * while it keeps failing the issue is never commented on, because comments
 *     notify. Only the "latest failing run" block in its body is rewritten;
 *   * the first run it passes closes the issue with one short comment;
 *   * skipped, cancelled and every other conclusion change nothing. They say
 *     nothing about whether the job works.
 *
 * The issue is found by a hidden marker in its BODY holding the workflow and job
 * name, never by its title, which a person may edit. Only issues a bot opened are
 * considered, so a person quoting the marker in their own issue does not get that
 * issue rewritten or closed.
 *
 * A RENAMED OR REMOVED JOB can never pass under its old name, so its issue would
 * stay open forever and become exactly the standing noise this exists to end. It
 * is closed as not planned, with one comment, by the first run that finished
 * without any job of that name. Only a first attempt counts: a re-run is not
 * trusted to list every job. If a renamed job still fails, the new name has
 * already opened its own issue.
 *
 * CLOSING THE ISSUE BY HAND DOES NOT MUTE THE JOB. Only open issues are read, so
 * the next failing run files a new one, and the issue body says so. Muting would
 * mean reading closed issues back and recording when the mute ends; fixing or
 * removing the job is the way to stop the notifications.
 *
 * Exits non-zero when it could not finish, so a broken reporter is at least red.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The runs worth reporting on. A push or pull request has its own checks list. */
const WATCHED_EVENTS = new Set(["schedule", "workflow_dispatch"]);

/** A job killed by its timeout did not work either. */
const FAILED = new Set(["failure", "timed_out"]);
const PASSED = new Set(["success"]);

const LABELS = ["bug"];

const LATEST_OPEN = "<!-- latest-failure -->";
const LATEST_CLOSE = "<!-- /latest-failure -->";

const PER_PAGE = 100;
const MAX_PAGES = 30;
const GET_ATTEMPTS = 3;

export function markerFor(workflow, job) {
  // With every `>` escaped, no workflow or job name can end the HTML comment
  // early, and the escape still parses back to the same name.
  const json = JSON.stringify({ workflow, job }).replace(/>/g, "\\u003e");
  return `<!-- scheduled-failure ${json} -->`;
}

export function fingerprintIn(body) {
  const match = /<!-- scheduled-failure (\{.*?\}) -->/.exec(body ?? "");
  if (!match) return null;
  try {
    const { workflow, job } = JSON.parse(match[1]);
    return typeof workflow === "string" && typeof job === "string"
      ? { workflow, job }
      : null;
  } catch {
    return null;
  }
}

/** The watched run, from the workflow_run event payload. */
export function runFrom(event) {
  const run = event?.workflow_run;
  if (!run) {
    throw new Error("The event has no workflow_run; this only runs on workflow_run.");
  }
  const defaultBranch = event.repository?.default_branch;
  if (!defaultBranch) {
    // Loud, because a missing branch would otherwise skip every run in silence.
    throw new Error("The event names no default branch, so no run can be judged.");
  }
  return {
    id: run.id,
    workflow: run.name,
    event: run.event,
    headBranch: run.head_branch,
    defaultBranch,
    conclusion: run.conclusion,
    attempt: run.run_attempt ?? 1,
    number: run.run_number,
    url: run.html_url,
    startedAt: run.run_started_at ?? run.created_at,
  };
}

/** Why this run is not reported on, or null when it is. */
export function ignoredBecause(run) {
  if (!WATCHED_EVENTS.has(run.event)) {
    return `a ${run.event} run is not reported on; only scheduled and manually started runs are`;
  }
  if (run.headBranch !== run.defaultBranch) {
    return `it ran on ${run.headBranch}, and only ${run.defaultBranch} decides whether a scheduled job works`;
  }
  return null;
}

/**
 * Pass, fail or neither, per job name. Two jobs can share a name (a matrix, or a
 * copy-paste), and they share one issue, so one failure makes the name fail.
 */
export function verdicts(jobs) {
  const byName = new Map();
  for (const job of jobs) {
    const held = byName.get(job.name);
    if (FAILED.has(job.conclusion)) {
      if (held?.verdict !== "failing") byName.set(job.name, { verdict: "failing", job });
    } else if (PASSED.has(job.conclusion)) {
      if (!held || held.verdict === "neither") byName.set(job.name, { verdict: "passing", job });
    } else if (!held) {
      byName.set(job.name, { verdict: "neither", job });
    }
  }
  return byName;
}

function when(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "an unknown time"
    : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function runLink(run, job) {
  const attempt = run.attempt > 1 ? `, attempt ${run.attempt}` : "";
  return `[${run.workflow} #${run.number}${attempt}](${job?.html_url ?? run.url})`;
}

function latestBlock(run, job) {
  const kind = run.event === "schedule" ? "scheduled" : "manually started";
  return [
    LATEST_OPEN,
    `**Latest failing run:** ${runLink(run, job)}, ${kind}, ${when(run.startedAt)}.`,
    LATEST_CLOSE,
  ].join("\n");
}

/** The body with only its latest-failure block replaced; untouched without one. */
export function withLatestFailure(body, block) {
  const start = body.indexOf(LATEST_OPEN);
  const end = body.indexOf(LATEST_CLOSE, start);
  if (start === -1 || end === -1) return body;
  return body.slice(0, start) + block + body.slice(end + LATEST_CLOSE.length);
}

function openingBody(run, name, job) {
  const kind = run.event === "schedule" ? "scheduled" : "manually started";
  return [
    markerFor(run.workflow, name),
    `**${name}** in the **${run.workflow}** workflow failed on a ${kind} run.`,
    "",
    "This is the only notification about it. While the job keeps failing this " +
      "issue gets no comments; only the line below is kept current. It closes " +
      "itself, with one comment, the first time the job passes on a scheduled or " +
      "manually started run of the default branch.",
    "",
    "Closing it by hand while the job still fails does not silence it: the next " +
      "failing run files a new issue. To stop these, fix the job or remove it.",
    "",
    latestBlock(run, job),
    "",
    `**First failing run:** ${runLink(run, job)}, ${when(run.startedAt)}.`,
    "",
    "To check a fix without waiting for the schedule, start the workflow by hand " +
      "from the Actions tab on the default branch (a job that runs only on the " +
      "schedule will wait for it). The title can be edited freely; the hidden " +
      "marker at the top of this body is what ties the issue to the job, so keep it.",
    "",
    "Filed by `.github/workflows/scheduled-failures.yml`.",
  ].join("\n");
}

/**
 * What to do about one completed run, as a list of decisions with no I/O, so the
 * rules can be tested without a GitHub.
 */
export function plan({ run, jobs, issues }) {
  const held = new Map();
  for (const issue of issues) {
    if (issue.pull_request || issue.user?.type !== "Bot") continue;
    const fingerprint = fingerprintIn(issue.body);
    if (!fingerprint || fingerprint.workflow !== run.workflow) continue;
    // The oldest wins, so a duplicate left by some past race never takes over.
    const current = held.get(fingerprint.job);
    if (!current || issue.number < current.number) held.set(fingerprint.job, issue);
  }

  const decisions = [];
  const byName = verdicts(jobs);
  for (const [name, { verdict, job }] of byName) {
    const issue = held.get(name);
    if (verdict === "failing" && !issue) {
      decisions.push({
        kind: "open",
        job: name,
        title: `Scheduled job failing: ${run.workflow} / ${name}`,
        body: openingBody(run, name, job),
        labels: LABELS,
      });
    } else if (verdict === "failing") {
      const body = withLatestFailure(issue.body, latestBlock(run, job));
      decisions.push(
        body === issue.body
          ? { kind: "keep", job: name, issue: issue.number }
          : { kind: "refresh", job: name, issue: issue.number, body },
      );
    } else if (verdict === "passing" && issue) {
      decisions.push({
        kind: "close",
        job: name,
        issue: issue.number,
        reason: "completed",
        comment: `Passed on ${runLink(run, job)}, ${when(run.startedAt)}. Closed.`,
      });
    } else {
      decisions.push({ kind: "none", job: name, verdict });
    }
  }

  const complete =
    run.attempt === 1 &&
    (run.conclusion === "success" || run.conclusion === "failure") &&
    jobs.length > 0;
  if (complete) {
    for (const [name, issue] of held) {
      if (byName.has(name)) continue;
      decisions.push({
        kind: "close",
        job: name,
        issue: issue.number,
        reason: "not_planned",
        comment:
          `No job named "${name}" ran in ${runLink(run)}, so it was renamed or ` +
          "removed and can never pass under this name. Closed rather than left " +
          "open, since nothing else could close it. If it was renamed and still " +
          "fails, the new name has its own issue.",
      });
    }
  }

  return decisions;
}

async function openIssue(github, decision, log) {
  try {
    return await github.createIssue(decision);
  } catch (error) {
    // A renamed or deleted label must not cost the one notification this sends.
    if (decision.labels.length === 0 || !(error.status >= 400 && error.status < 500)) {
      throw error;
    }
    log(`! Could not file with labels ${decision.labels.join(", ")} (${error.message}); filing without them.`);
    return github.createIssue({ ...decision, labels: [] });
  }
}

/** Carry the decisions out. One failed write does not stop the rest. */
export async function apply(decisions, github, log) {
  const failures = [];
  for (const decision of decisions) {
    const what = `${decision.job}:`;
    try {
      switch (decision.kind) {
        case "open": {
          const issue = await openIssue(github, decision, log);
          log(`${what} failing, opened #${issue.number}`);
          break;
        }
        case "refresh":
          await github.updateIssue(decision.issue, { body: decision.body });
          log(`${what} still failing, #${decision.issue} refreshed without a comment`);
          break;
        case "keep":
          log(`${what} still failing, #${decision.issue} already current`);
          break;
        case "close":
          // Closed before the comment: a comment followed by a failed close
          // would be posted again by every later run until a close got through.
          await github.updateIssue(decision.issue, {
            state: "closed",
            state_reason: decision.reason,
          });
          log(`${what} ${decision.reason === "completed" ? "passing" : "gone"}, closed #${decision.issue}`);
          await github.createComment(decision.issue, decision.comment);
          break;
        default:
          log(`${what} ${decision.verdict}, nothing to do`);
      }
    } catch (error) {
      failures.push(`${what} ${error.message}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`${failures.length} write(s) failed:\n  ${failures.join("\n  ")}`);
  }
}

/** Read the run's jobs and the open issues, decide, and act (or only print). */
export async function report({ event, github, dryRun = false, log = console.log }) {
  const run = runFrom(event);
  const ignored = ignoredBecause(run);
  if (ignored) {
    log(`Nothing to do for ${run.workflow} #${run.number}: ${ignored}.`);
    return [];
  }

  const jobs = await github.listJobs(run.id);
  if (jobs.length === 0) {
    log(`::warning::${run.workflow} #${run.number} ended ${run.conclusion} with no jobs listed, so there is nothing to report per job.`);
  }
  const issues = await github.listOpenIssues();
  const decisions = plan({ run, jobs, issues });

  log(`${run.workflow} #${run.number} (${run.event}, ${run.conclusion}):`);
  if (dryRun) {
    const would = {
      open: "would open an issue",
      refresh: "would refresh",
      keep: "would leave alone",
      close: "would close",
      none: "nothing to do",
    };
    for (const decision of decisions) {
      const target = decision.issue ? ` #${decision.issue}` : "";
      log(`  ${decision.job}: ${would[decision.kind]}${target}`);
    }
    return decisions;
  }
  await apply(decisions, github, (line) => log(`  ${line}`));
  return decisions;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The few REST calls this needs, against one repository. */
export function gitHubClient({ token, repo, fetchImpl = fetch, pause = sleep }) {
  async function call(method, path, body) {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "loonext-scheduled-failures",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      let detail = "";
      try {
        detail = (await response.json())?.message ?? "";
      } catch {
        // No JSON body; the status is the whole answer.
      }
      throw Object.assign(
        new Error(`${method} ${path}: HTTP ${response.status}${detail ? ` (${detail})` : ""}`),
        { status: response.status },
      );
    }
    return response.status === 204 ? null : response.json();
  }

  // Reads only: retrying a create or a comment after a lost response could file
  // it twice, and a second comment is a second notification.
  async function get(path) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await call("GET", path);
      } catch (error) {
        const transient = !error.status || error.status >= 500 || error.status === 429;
        if (!transient || attempt === GET_ATTEMPTS) throw error;
        await pause(attempt * 2000);
      }
    }
  }

  return {
    async listJobs(runId) {
      const jobs = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const body = await get(
          `/actions/runs/${runId}/jobs?filter=latest&per_page=${PER_PAGE}&page=${page}`,
        );
        jobs.push(...body.jobs);
        if (body.jobs.length < PER_PAGE || jobs.length >= body.total_count) return jobs;
      }
      throw new Error(`Run ${runId} lists more than ${MAX_PAGES * PER_PAGE} jobs.`);
    },
    async listOpenIssues() {
      const issues = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const batch = await get(`/issues?state=open&per_page=${PER_PAGE}&page=${page}`);
        issues.push(...batch);
        if (batch.length < PER_PAGE) return issues;
      }
      // Stopping short could miss an open issue and file its duplicate.
      throw new Error(`More than ${MAX_PAGES * PER_PAGE} open issues; refusing to guess.`);
    },
    createIssue: ({ title, body, labels }) => call("POST", "/issues", { title, body, labels }),
    updateIssue: (number, patch) => call("PATCH", `/issues/${number}`, patch),
    createComment: (number, body) => call("POST", `/issues/${number}/comments`, { body }),
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const token = process.env.GITHUB_TOKEN;
  // No default repository, unlike the read-only checks: this one files issues,
  // and a stray local run must not reach the real tracker.
  const repo = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!token || !repo || !eventPath) {
    console.error("GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_EVENT_PATH must all be set.");
    process.exit(1);
  }
  if (!dryRun && process.env.GITHUB_ACTIONS !== "true") {
    console.error("This writes issues, so it only does so inside GitHub Actions. Use --dry-run to see the plan.");
    process.exit(1);
  }

  try {
    const event = JSON.parse(readFileSync(eventPath, "utf8"));
    await report({ event, github: gitHubClient({ token, repo }), dryRun });
  } catch (error) {
    console.error(`Could not report on this run: ${error.message}`);
    process.exit(1);
  }
}

// Only when run, never when imported by its test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
