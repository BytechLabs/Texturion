import { OwnershipView } from "@/components/ownership/ownership-view";

export const metadata = {
  title: "Ownership",
};

/**
 * /ownership (#515) — the succession surface for whoever opens it.
 *
 * Deliberately NOT under /settings. The person this page exists for is the
 * named backup owner, who is routinely a plain member — #332 lets an owner
 * name any active teammate, because a succession plan that only works for
 * admins is not a succession plan — and every settings section that carries an
 * ownership control sits behind `team.manage`. Every ownership email points
 * here.
 *
 * Nothing on it is privileged: GET /v1/company/ownership is mounted at
 * `workspace.access` and answers who-may-act as per-caller booleans, so a
 * reader with no part in a handover simply has no buttons.
 */
export default function OwnershipRoute() {
  return <OwnershipView />;
}
