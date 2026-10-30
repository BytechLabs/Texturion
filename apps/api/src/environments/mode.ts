import type { Env } from "../env";

export type DeployEnv = "local" | "rig" | "production";

/**
 * The one reader of DEPLOY_ENV (D142).
 *
 * Nothing outside `src/environments/` may import this. Code elsewhere asks a
 * policy question of this directory ("may I dial this number?") instead of
 * branching on the answer, so every difference between production and the rig
 * is readable in one place and can be checked to be a restriction.
 * `scripts/check-deploy-env-branches.mjs` enforces both rules.
 */
export function deployEnv(env: Pick<Env, "DEPLOY_ENV">): DeployEnv {
  return env.DEPLOY_ENV ?? "local";
}
