import { capabilityActions, defineMachine } from "./define-machine";

/**
 * A team invite, derived from accepted_at, revoked_at and expires_at on
 * invites (routes/team.ts). Resend extends expires_at, so an expired invite
 * returns to pending.
 *
 * Phase 1 of #722: definition only, no runtime behaviour. See docs/STATE-MACHINES.md.
 */
export type InviteState = "pending" | "accepted" | "revoked" | "expired";

/** A team invite, derived from accepted_at, revoked_at and expires_at on invites (routes/team.ts). */
export const inviteMachine = defineMachine<InviteState>({
  id: "invite",
  authority: "derived",
  db: {
    kind: "none",
    columns: [{ table: "invites", column: "accepted_at" }, { table: "invites", column: "revoked_at" }, { table: "invites", column: "expires_at" }],
    note: "derived from accepted_at, revoked_at and expires_at",
  },
  states: ["pending", "accepted", "revoked", "expired"],
  initial: ["pending"],
  transitions: {
    pending: ["pending", "accepted", "revoked", "expired"],
    accepted: [],
    revoked: [],
    expired: ["pending", "revoked"],
  },
  entryEffects: {
    accepted: ["create_membership"],
  },
  actions: capabilityActions<InviteState>({
    pending: [{ action: "resend", capability: "team.manage" }, { action: "revoke", capability: "team.manage" }],
    expired: [{ action: "resend", capability: "team.manage" }, { action: "revoke", capability: "team.manage" }],
  }),
});
