/**
 * The rpc methods the `synthetic-triage` task calls through
 * `/ctl/rpc`. They are thin on purpose: the task decides, the rig acts within
 * limits it enforces itself.
 */
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
}

export type TriageMethods = Record<string, (params: unknown) => Promise<unknown>>;

export const TRIAGE_METHODS = ["triage.unresolved", "triage.rerun", "triage.evidence"] as const;

export function triageMethods(deps: TriageDeps): TriageMethods {
  return {
    async "triage.unresolved"() {
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
  };
}

function record(params: unknown): Record<string, unknown> {
  if (params === null || typeof params !== "object" || Array.isArray(params)) return {};
  return params as Record<string, unknown>;
}
