import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * One issue per failing scheduled job, and nothing else (D140).
 *
 * These drive the real `scripts/report-scheduled-failures.mjs`, run after run,
 * against a fake GitHub that remembers what was filed, and count everything that
 * would have notified somebody: an opened issue, a comment, a close.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

type Job = { name: string; conclusion: string | null; html_url?: string };
type IssueInput = { title: string; body: string; labels: string[] };
type Decision = { kind: string; job: string; issue?: number };
type Client = {
  listJobs: (runId: number) => Promise<Job[]>;
  listOpenIssues: () => Promise<unknown[]>;
  createIssue: (input: IssueInput) => Promise<{ number: number }>;
  updateIssue: (number: number, patch: Record<string, unknown>) => Promise<unknown>;
  createComment: (number: number, body: string) => Promise<unknown>;
};

const { report, gitHubClient, markerFor, fingerprintIn } = (await import(
  join(REPO, "scripts", "report-scheduled-failures.mjs")
)) as {
  report: (args: {
    event: unknown;
    github: Client;
    dryRun?: boolean;
    log?: (line: string) => void;
  }) => Promise<Decision[]>;
  gitHubClient: (args: {
    token: string;
    repo: string;
    fetchImpl: (url: string, init: { method: string }) => Promise<Response>;
    pause?: (ms: number) => Promise<void>;
  }) => Client;
  markerFor: (workflow: string, job: string) => string;
  fingerprintIn: (body: string) => { workflow: string; job: string } | null;
};

type Issue = {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: "open" | "closed";
  state_reason: string | null;
  user: { login: string; type: "Bot" | "User" };
  comments: string[];
};

/** A GitHub that keeps its issues between runs, and counts what would notify. */
function fakeGitHub({ knownLabels = ["bug"] }: { knownLabels?: string[] } = {}) {
  const issues: Issue[] = [];
  const jobsByRun = new Map<number, Job[]>();
  const notified: string[] = [];
  const bodyEdits: number[] = [];
  let jobListings = 0;
  let createAttempts = 0;
  let failCreate = false;
  let failListing = false;
  let closesToFail = 0;

  const find = (number: number) => {
    const issue = issues.find((candidate) => candidate.number === number);
    if (!issue) throw Object.assign(new Error(`no issue #${number}`), { status: 404 });
    return issue;
  };

  const client: Client = {
    async listJobs(runId) {
      jobListings += 1;
      return jobsByRun.get(runId) ?? [];
    },
    async listOpenIssues() {
      if (failListing) throw Object.assign(new Error("HTTP 502"), { status: 502 });
      return issues.filter((issue) => issue.state === "open").map((issue) => ({ ...issue }));
    },
    async createIssue({ title, body, labels }) {
      createAttempts += 1;
      if (failCreate) throw Object.assign(new Error("HTTP 502"), { status: 502 });
      if (labels.some((label) => !knownLabels.includes(label))) {
        throw Object.assign(new Error("HTTP 422 (Validation Failed)"), { status: 422 });
      }
      const issue: Issue = {
        number: issues.length + 1,
        title,
        body,
        labels,
        state: "open",
        state_reason: null,
        user: { login: "github-actions[bot]", type: "Bot" },
        comments: [],
      };
      issues.push(issue);
      notified.push(`opened #${issue.number}`);
      return { number: issue.number };
    },
    async updateIssue(number, patch) {
      const issue = find(number);
      if (typeof patch.body === "string") {
        issue.body = patch.body;
        bodyEdits.push(number);
      }
      if (patch.state === "closed") {
        if (closesToFail > 0) {
          closesToFail -= 1;
          throw Object.assign(new Error("HTTP 502"), { status: 502 });
        }
        issue.state = "closed";
        issue.state_reason = String(patch.state_reason);
        notified.push(`closed #${number}`);
      }
      return issue;
    },
    async createComment(number, body) {
      find(number).comments.push(body);
      notified.push(`commented #${number}`);
      return {};
    },
  };

  return {
    client,
    issues,
    notified,
    bodyEdits,
    jobsByRun,
    jobListings: () => jobListings,
    createAttempts: () => createAttempts,
    failCreates: () => {
      failCreate = true;
    },
    failListings: () => {
      failListing = true;
    },
    failNextCloses: (count: number) => {
      closesToFail = count;
    },
    /** A person closing an issue in the UI, which notifies nobody this counts. */
    closeByHand(number: number, reason: "completed" | "not_planned") {
      const issue = find(number);
      issue.state = "closed";
      issue.state_reason = reason;
    },
    /** Somebody's own issue, typed by a person. */
    addHumanIssue(body: string) {
      issues.push({
        number: issues.length + 1,
        title: "How the scheduled reporter works",
        body,
        labels: [],
        state: "open",
        state_reason: null,
        user: { login: "a-person", type: "User" },
        comments: [],
      });
    },
  };
}

let nextRunId = 5000;

/** One completed run of a watched workflow, reported on. */
async function complete(
  gh: ReturnType<typeof fakeGitHub>,
  jobs: Record<string, string | null>,
  {
    workflow = "Security",
    event = "schedule",
    branch = "main",
    conclusion,
    attempt = 1,
  }: {
    workflow?: string;
    event?: string;
    branch?: string;
    conclusion?: string;
    attempt?: number;
  } = {},
) {
  const id = (nextRunId += 1);
  const url = `https://github.com/BytechLabs/Texturion/actions/runs/${id}`;
  gh.jobsByRun.set(
    id,
    Object.entries(jobs).map(([name, jobConclusion], index) => ({
      name,
      conclusion: jobConclusion,
      html_url: `${url}/job/${id * 10 + index}`,
    })),
  );
  const failed = Object.values(jobs).some((value) => value === "failure");
  await report({
    event: {
      repository: { default_branch: "main", full_name: "BytechLabs/Texturion" },
      workflow_run: {
        id,
        name: workflow,
        event,
        head_branch: branch,
        conclusion: conclusion ?? (failed ? "failure" : "success"),
        run_attempt: attempt,
        run_number: id - 4000,
        html_url: url,
        run_started_at: "2026-10-26T06:41:12Z",
      },
    },
    github: gh.client,
    log: () => {},
  });
  return { url };
}

const open = (gh: ReturnType<typeof fakeGitHub>) =>
  gh.issues.filter((issue) => issue.state === "open");

describe("a failing scheduled job gets one issue, once", () => {
  it("opens one issue on the first failure, and that is the only notification", async () => {
    const gh = fakeGitHub();
    const { url } = await complete(gh, { "Secret scan": "success", "pnpm audit": "failure" });

    expect(gh.issues).toHaveLength(1);
    const [issue] = gh.issues;
    expect(issue.title).toBe("Scheduled job failing: Security / pnpm audit");
    expect(issue.labels).toEqual(["bug"]);
    expect(issue.body).toContain(url);
    expect(fingerprintIn(issue.body)).toEqual({ workflow: "Security", job: "pnpm audit" });
    expect(gh.notified).toEqual(["opened #1"]);
  });

  it("never comments while the job keeps failing, and only refreshes the latest run in the body", async () => {
    const gh = fakeGitHub();
    const first = await complete(gh, { "pnpm audit": "failure" });
    await complete(gh, { "pnpm audit": "failure" });
    const third = await complete(gh, { "pnpm audit": "failure" });

    expect(gh.issues).toHaveLength(1);
    expect(gh.issues[0].comments).toEqual([]);
    expect(gh.notified).toEqual(["opened #1"]);
    expect(gh.bodyEdits).toEqual([1, 1]);
    expect(gh.issues[0].body).toContain(third.url);
    // The first failure stays on record; only the latest-run block moves.
    expect(gh.issues[0].body).toContain(first.url);
    expect(fingerprintIn(gh.issues[0].body)).toEqual({ workflow: "Security", job: "pnpm audit" });
  });

  it("gives a second failing job its own issue while the first is still open: the 2026-09-14 case", async () => {
    const gh = fakeGitHub();
    await complete(gh, { "Dependency graph is on": "failure", "pnpm audit": "success" });
    await complete(gh, { "Dependency graph is on": "failure", "pnpm audit": "failure" });

    expect(open(gh).map((issue) => issue.title)).toEqual([
      "Scheduled job failing: Security / Dependency graph is on",
      "Scheduled job failing: Security / pnpm audit",
    ]);
    expect(gh.notified).toEqual(["opened #1", "opened #2"]);
  });

  it("keeps a job name that could end an HTML comment inside the marker", () => {
    const marker = markerFor("Security", "a --> b");
    expect(marker.indexOf("-->")).toBe(marker.length - 3);
    expect(fingerprintIn(`${marker}\nbody`)).toEqual({ workflow: "Security", job: "a --> b" });
  });

  it("counts a job killed by its timeout as failing", async () => {
    const gh = fakeGitHub();
    await complete(gh, { "Are backups still arriving?": "timed_out" }, { workflow: "Backup posture" });

    expect(open(gh).map((issue) => issue.title)).toEqual([
      "Scheduled job failing: Backup posture / Are backups still arriving?",
    ]);
  });
});

describe("a job that passes again closes its issue", () => {
  it("closes with one short comment linking the green run", async () => {
    const gh = fakeGitHub();
    await complete(gh, { "pnpm audit": "failure" });
    const green = await complete(gh, { "pnpm audit": "success" });

    const [issue] = gh.issues;
    expect(issue.state).toBe("closed");
    expect(issue.state_reason).toBe("completed");
    expect(issue.comments).toHaveLength(1);
    expect(issue.comments[0]).toContain(green.url);
    expect(gh.notified).toEqual(["opened #1", "closed #1", "commented #1"]);
  });

  it("comments once when the close fails and a later run gets it through", async () => {
    const gh = fakeGitHub();
    await complete(gh, { "pnpm audit": "failure" });
    gh.failNextCloses(2);

    await expect(complete(gh, { "pnpm audit": "success" })).rejects.toThrow(/1 write\(s\) failed/);
    await expect(complete(gh, { "pnpm audit": "success" })).rejects.toThrow(/1 write\(s\) failed/);
    expect(gh.issues[0]).toMatchObject({ state: "open", comments: [] });

    await complete(gh, { "pnpm audit": "success" });
    expect(gh.issues[0].state).toBe("closed");
    expect(gh.issues[0].comments).toHaveLength(1);
    expect(gh.notified).toEqual(["opened #1", "closed #1", "commented #1"]);
  });

  it("opens a fresh issue if the job fails again after it closed", async () => {
    const gh = fakeGitHub();
    await complete(gh, { "pnpm audit": "failure" });
    await complete(gh, { "pnpm audit": "success" });
    await complete(gh, { "pnpm audit": "failure" });

    expect(open(gh).map((issue) => issue.number)).toEqual([2]);
  });

  it("files again after a person closes the issue while the job still fails, as the body warns", async () => {
    const gh = fakeGitHub();
    await complete(gh, { "pnpm audit": "failure" });
    expect(gh.issues[0].body).toContain(
      "Closing it by hand while the job still fails does not silence it",
    );

    gh.closeByHand(1, "not_planned");
    await complete(gh, { "pnpm audit": "failure" });

    expect(open(gh).map((issue) => issue.number)).toEqual([2]);
    expect(gh.issues[0]).toMatchObject({ state: "closed", comments: [] });
    expect(gh.notified).toEqual(["opened #1", "opened #2"]);
  });

  it("finds its issue by the body marker after a person edits the title", async () => {
    const gh = fakeGitHub();
    await complete(gh, { "pnpm audit": "failure" });
    gh.issues[0].title = "Critical advisories: bump next and undici";
    await complete(gh, { "pnpm audit": "failure" });
    await complete(gh, { "pnpm audit": "success" });

    expect(gh.issues).toHaveLength(1);
    expect(gh.issues[0].state).toBe("closed");
  });

  it("passing with no open issue does nothing at all", async () => {
    const gh = fakeGitHub();
    await complete(gh, { "Secret scan": "success", "pnpm audit": "success" });

    expect(gh.issues).toEqual([]);
    expect(gh.notified).toEqual([]);
  });
});

describe("what changes nothing", () => {
  it.each(["skipped", "cancelled", "neutral", null])(
    "a %s job neither opens nor closes nor edits an issue",
    async (conclusion) => {
      const gh = fakeGitHub();
      await complete(gh, { "pnpm audit": "failure" });
      const before = gh.issues[0].body;
      await complete(gh, {
        "pnpm audit": conclusion,
        "Dependency graph is on": conclusion,
        "Secret scan": "success",
      });

      expect(gh.issues).toHaveLength(1);
      expect(gh.issues[0].state).toBe("open");
      expect(gh.issues[0].body).toBe(before);
      expect(gh.notified).toEqual(["opened #1"]);
    },
  );

  it.each(["push", "pull_request"])("a %s run is never acted on, or even read", async (event) => {
    const gh = fakeGitHub();
    await complete(gh, { "pnpm audit": "failure" });
    await complete(gh, { "pnpm audit": "success" }, { event });
    await complete(gh, { "Dependency graph is on": "failure" }, { event });

    expect(gh.jobListings()).toBe(1);
    expect(open(gh).map((issue) => issue.title)).toEqual([
      "Scheduled job failing: Security / pnpm audit",
    ]);
    expect(gh.notified).toEqual(["opened #1"]);
  });

  it("a manually started run on the default branch counts, one on another branch does not", async () => {
    const gh = fakeGitHub();
    await complete(gh, { "Dependency graph is on": "failure" }, { event: "workflow_dispatch" });
    expect(open(gh)).toHaveLength(1);

    // A branch's fix passing proves nothing about the default branch.
    await complete(gh, { "Dependency graph is on": "success" }, {
      event: "workflow_dispatch",
      branch: "fix/graph",
    });
    await complete(gh, { "pnpm audit": "failure" }, { event: "workflow_dispatch", branch: "fix/graph" });
    // Which issue and what notified, not how many: counts alone still match
    // when the branch runs wrongly close #1 and open a #2 in its place.
    expect(open(gh).map((issue) => issue.number)).toEqual([1]);
    expect(gh.notified).toEqual(["opened #1"]);

    await complete(gh, { "Dependency graph is on": "success" }, { event: "workflow_dispatch" });
    expect(open(gh)).toHaveLength(0);
    expect(gh.notified).toEqual(["opened #1", "closed #1", "commented #1"]);
  });

  it("another workflow's issue is not touched by this workflow's run", async () => {
    const gh = fakeGitHub();
    await complete(gh, { "Are backups still arriving?": "failure" }, { workflow: "Backup posture" });
    await complete(gh, { "Secret scan": "success", "pnpm audit": "success" });

    expect(open(gh).map((issue) => issue.title)).toEqual([
      "Scheduled job failing: Backup posture / Are backups still arriving?",
    ]);
    expect(gh.notified).toEqual(["opened #1"]);
  });

  it("a person's issue quoting the marker is never edited or closed", async () => {
    const gh = fakeGitHub();
    gh.addHumanIssue(`The reporter writes ${markerFor("Security", "pnpm audit")} into its issues.`);
    const quoted = gh.issues[0].body;
    await complete(gh, { "pnpm audit": "failure" });
    await complete(gh, { "pnpm audit": "success" });

    expect(gh.issues[0]).toMatchObject({ state: "open", body: quoted, comments: [] });
    expect(gh.issues[1].state).toBe("closed");
  });
});

describe("a renamed job", () => {
  it("the new name opens its own issue, and the old name's issue closes as not planned on the first run it is missing from", async () => {
    const gh = fakeGitHub();
    await complete(gh, { "pnpm audit": "failure" });
    await complete(gh, { "Audit production dependencies": "failure" });

    const [renamedAway, renamedTo] = gh.issues;
    expect(renamedAway.state).toBe("closed");
    expect(renamedAway.state_reason).toBe("not_planned");
    expect(renamedAway.comments).toHaveLength(1);
    expect(renamedAway.comments[0]).toContain("pnpm audit");
    expect(renamedTo).toMatchObject({
      state: "open",
      title: "Scheduled job failing: Security / Audit production dependencies",
    });
  });

  it("is not assumed gone from a re-run or a cancelled run, which may not list every job", async () => {
    const gh = fakeGitHub();
    await complete(gh, { "pnpm audit": "failure", "Secret scan": "success" });
    await complete(gh, { "Secret scan": "success" }, { attempt: 2 });
    await complete(gh, { "Secret scan": "cancelled" }, { conclusion: "cancelled" });

    expect(gh.issues[0].state).toBe("open");
    expect(gh.notified).toEqual(["opened #1"]);
  });
});

describe("the one notification is not lost to a side problem", () => {
  it("files without the label when the label is refused", async () => {
    const gh = fakeGitHub({ knownLabels: [] });
    await complete(gh, { "pnpm audit": "failure" });

    expect(gh.issues).toHaveLength(1);
    expect(gh.issues[0].labels).toEqual([]);
  });

  it("carries on past a failed write, then fails the run so the reporter is red", async () => {
    const gh = fakeGitHub();
    await complete(gh, { "pnpm audit": "failure" });
    gh.failCreates();

    await expect(
      complete(gh, { "Dependency graph is on": "failure", "pnpm audit": "success" }),
    ).rejects.toThrow(/1 write\(s\) failed/);
    expect(gh.issues[0].state).toBe("closed");
  });

  it("writes nothing when the open issues cannot be listed, since every standing issue would look missing", async () => {
    const gh = fakeGitHub();
    await complete(gh, { "pnpm audit": "failure" });
    gh.failListings();

    await expect(
      complete(gh, { "pnpm audit": "failure", "Dependency graph is on": "failure" }),
    ).rejects.toMatchObject({ status: 502 });
    expect(gh.createAttempts()).toBe(1);
    expect(gh.issues).toHaveLength(1);
    expect(gh.bodyEdits).toEqual([]);
    expect(gh.notified).toEqual(["opened #1"]);
  });
});

describe("the REST client", () => {
  it("reads every page of open issues and jobs rather than the first hundred", async () => {
    const requested: string[] = [];
    const page = (count: number, offset: number) =>
      Array.from({ length: count }, (_, index) => ({ number: offset + index + 1 }));
    const client = gitHubClient({
      token: "test-token",
      repo: "owner/repo",
      async fetchImpl(url) {
        requested.push(url);
        const pageNumber = Number(new URL(url).searchParams.get("page"));
        const body = url.includes("/jobs")
          ? { total_count: 101, jobs: page(pageNumber === 1 ? 100 : 1, (pageNumber - 1) * 100) }
          : page(pageNumber === 1 ? 100 : 7, (pageNumber - 1) * 100);
        return new Response(JSON.stringify(body), { status: 200 });
      },
    });

    expect(await client.listOpenIssues()).toHaveLength(107);
    expect(await client.listJobs(42)).toHaveLength(101);
    expect(requested.every((url) => url.startsWith("https://api.github.com/repos/owner/repo/"))).toBe(true);
    expect(requested.filter((url) => url.includes("/jobs")).every((url) => url.includes("filter=latest"))).toBe(true);
  });

  it("refuses an issue list longer than it will page through, rather than return part of it", async () => {
    let pages = 0;
    const client = gitHubClient({
      token: "test-token",
      repo: "owner/repo",
      async fetchImpl(url) {
        pages += 1;
        const offset = (Number(new URL(url).searchParams.get("page")) - 1) * 100;
        const full = Array.from({ length: 100 }, (_, index) => ({ number: offset + index + 1 }));
        return new Response(JSON.stringify(full), { status: 200 });
      },
    });

    await expect(client.listOpenIssues()).rejects.toThrow(/refusing to guess/);
    expect(pages).toBe(30);
  });

  it("retries a read through a server error but never a write", async () => {
    let calls = 0;
    const client = gitHubClient({
      token: "test-token",
      repo: "owner/repo",
      pause: async () => {},
      async fetchImpl() {
        calls += 1;
        return new Response(JSON.stringify({ message: "upstream" }), { status: 502 });
      },
    });

    await expect(client.listOpenIssues()).rejects.toMatchObject({ status: 502 });
    expect(calls).toBe(3);
    calls = 0;
    await expect(client.createComment(1, "x")).rejects.toMatchObject({ status: 502 });
    expect(calls).toBe(1);
  });
});

describe("every scheduled workflow is watched", () => {
  const WORKFLOWS = join(REPO, ".github", "workflows");
  const files = readdirSync(WORKFLOWS).filter((name) => /\.ya?ml$/.test(name));
  const read = (name: string) => readFileSync(join(WORKFLOWS, name), "utf8").split(/\r?\n/);
  const nameOf = (lines: string[]) =>
    /^name:\s*["']?(.*?)["']?\s*$/.exec(lines.find((line) => line.startsWith("name:")) ?? "")?.[1];

  const scheduled = files
    .filter((file) => read(file).some((line) => /^\s+schedule:\s*$/.test(line)))
    .map((file) => nameOf(read(file)));

  const reporter = read("scheduled-failures.yml");
  const start = reporter.findIndex((line) => /^\s+workflows:\s*$/.test(line));
  const watched: string[] = [];
  for (const line of reporter.slice(start + 1)) {
    const item = /^\s+-\s+["']?(.*?)["']?\s*$/.exec(line);
    if (!item) break;
    watched.push(item[1]);
  }

  it("finds the scheduled workflows at all", () => {
    // A parse that matches nothing would make the next two pass over an empty set.
    expect(scheduled).toContain("Security");
    expect(start).toBeGreaterThan(-1);
  });

  it("watches every workflow that has a schedule", () => {
    expect(scheduled.filter((name) => !watched.includes(name ?? ""))).toEqual([]);
  });

  it("watches nothing that is not a scheduled workflow, since a wrong name watches nothing", () => {
    expect(watched.filter((name) => !scheduled.includes(name))).toEqual([]);
  });

  it("runs this script", () => {
    expect(
      reporter.some((line) => line.trim() === "run: node scripts/report-scheduled-failures.mjs"),
    ).toBe(true);
  });
});
