/**
 * The rpc methods the hourly `synthetic-triage` task calls through
 * `/ctl/rpc`. They are thin on purpose: the task decides, the rig acts within
 * limits it enforces itself.
 *
 * An issue can be filed only for a fingerprint the rig itself reports as
 * unresolved, so the token that reaches these methods cannot file anything else.
 */
import { installationToken, type AppCredentials } from "./github-app.ts";
import { isFingerprint, upsertSyntheticIssue, type IssueResult } from "./issues.ts";

export interface UnresolvedLike {
  scenario: string;
  fingerprint: string[];
}

/** A re-run that has started: its verdicts land under `run_id`, which `triage.evidence` reads. */
export interface StartedRun {
  started: true;
  scenario: string;
  run_id: string;
}

export interface TriageDeps {
  unresolved(): UnresolvedLike[];
  /** Starts the run and returns at once: a run outlasts the edge's 60 s rpc wait. */
  run(scenario: string): Promise<StartedRun>;
  evidence(runId: string): { verdicts: unknown[]; evidence: unknown[] };
  /** Read when an issue is filed, so a rig without the App key still triages. */
  app(): AppCredentials;
  /** Marks the triage heartbeat for the dead-man. */
  heartbeat(): void;
  fetch?: typeof fetch;
}

export type TriageMethods = Record<string, (params: unknown) => Promise<unknown>>;

export const TRIAGE_METHODS = ["triage.unresolved", "triage.rerun", "triage.evidence", "triage.issue"] as const;

export function triageMethods(deps: TriageDeps): TriageMethods {
  return {
    async "triage.unresolved"() {
      deps.heartbeat();
      return deps.unresolved();
    },

    async "triage.rerun"(params) {
      const { scenario } = record(params);
      if (typeof scenario !== "string") throw new Error("triage.rerun takes { scenario }");
      if (!deps.unresolved().some((u) => u.scenario === scenario)) {
        throw new Error(`${scenario} has no unresolved failure to re-run`);
      }
      return deps.run(scenario);
    },

    async "triage.evidence"(params) {
      const { run_id: runId } = record(params);
      if (typeof runId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(runId)) throw new Error("triage.evidence takes { run_id }");
      return deps.evidence(runId);
    },

    async "triage.issue"(params): Promise<IssueResult> {
      const { fingerprint, title, body } = record(params);
      if (!isFingerprint(fingerprint)) throw new Error("triage.issue takes a synthetic fingerprint");
      if (typeof title !== "string" || title.trim() === "" || typeof body !== "string" || body.trim() === "") {
        throw new Error("triage.issue takes a title and a body");
      }
      const key = fingerprint.join("/");
      if (!deps.unresolved().some((u) => u.fingerprint.join("/") === key)) {
        throw new Error(`${key} is not an unresolved failure on the rig`);
      }
      const app = deps.app();
      const token = await installationToken(app, { fetch: deps.fetch });
      return upsertSyntheticIssue(token, app.repo, { fingerprint, title, body }, deps.fetch);
    },
  };
}

function record(params: unknown): Record<string, unknown> {
  if (params === null || typeof params !== "object" || Array.isArray(params)) return {};
  return params as Record<string, unknown>;
}
