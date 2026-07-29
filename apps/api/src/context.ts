import type { Bindings } from "./env";

/** `member_role` enum values (SPEC §6). */
export const MEMBER_ROLES = ["owner", "admin", "member"] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

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
}

/** Hono type environment for the api Worker. */
export type AppEnv = {
  Bindings: Bindings;
  Variables: AppVariables;
};
