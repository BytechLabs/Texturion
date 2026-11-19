import { capabilityActions, defineMachine } from "./define-machine";
import type { CapabilityAction } from "./define-machine";

const OPEN_INVITE_ACTIONS: readonly CapabilityAction[] = [
  { action: "revoke", capability: "team.manage" },
  { action: "resend", capability: "team.manage" },
];

/**
 * A team invite, derived from accepted_at, revoked_at and expires_at on
 * invites. Extending expires_at returns an expired invite to pending.
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
    pending: OPEN_INVITE_ACTIONS,
    expired: OPEN_INVITE_ACTIONS,
  }),
});
