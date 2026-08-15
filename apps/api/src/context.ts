import type { Bindings } from "./env";

/**
 * `member_role` enum values (SPEC §6).
 *
 * #315: defined once in @loonext/shared, beside the capability table that will
 * replace the rank, so the API, the web app and the phones cannot hold three
 * different opinions about what roles exist while the presets land.
 */
import type { MemberRole } from "@loonext/shared";

export { MEMBER_ROLES, type MemberRole } from "@loonext/shared";

/**
 * Request-scoped variables set by the /v1 middleware chain (SPEC §7, §10):
 * `userId` by the JWT middleware (auth/jwt.ts); `companyId`, `role`, and
 * `memberId` by the company-context middleware (auth/company.ts). Route
 * handlers mounted behind the chain can rely on all of them being present.
 */
export interface AppVariables {
  userId: string;
  companyId: string;
  role: MemberRole;
  memberId: string;
  /**
   * #236: the `session_id` claim of the presented access token — the identity
   * of the DEVICE, as opposed to `userId`, the identity of the person. Absent
   * only for a token minted before GoTrue emitted the claim; every routine
   * that uses it must tolerate that.
   */
  sessionId?: string;
  /**
   * #314: GoTrue's authenticator assurance level for the presented token.
   * `aal2` means a second factor was verified for this session. Absent claims
   * read as `aal1`, which is the conservative direction.
   */
  aal: AssuranceLevel;
  /**
   * #581/#7 — WHEN a second factor was last proved on this token, in seconds
   * since the epoch, or null when it cannot be established (no `amr` claim, the
   * string form of it, or no second-factor entry).
   *
   * `aal` answers "was a factor verified for this session"; `companyContext` has
   * already forced that to `aal2` for anybody enrolled, which is why gating a
   * destructive act on `aal` asks such a caller for nothing. This answers "how
   * long ago", which is the question a confirmation is actually asking.
   */
  factorProvedAt: number | null;
  /**
   * #243 — set ONLY on the public surface, by `apiKeyAuth`.
   *
   * Optional because the first-party `/v1` chain never sets them, and that
   * asymmetry is load-bearing rather than incidental: `requireScope` reads
   * `apiKeyScopes` and refuses when it is absent, so a public route
   * accidentally mounted on the member chain fails closed rather than granting
   * every scope to every signed-in person.
   */
  apiKeyId?: string;
  apiKeyScopes?: string[];
}

/** SPEC §10 / GoTrue: `aal1` = password or OAuth alone, `aal2` = with MFA. */
export type AssuranceLevel = "aal1" | "aal2";

/** Hono type environment for the api Worker. */
export type AppEnv = {
  Bindings: Bindings;
  Variables: AppVariables;
};
