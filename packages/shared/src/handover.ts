/**
 * #515 — "if a user is asked to be a backup owner, that confirmation prompt is
 * in settings/team that they dont have access to."
 *
 * #332 put every ownership control inside the Team settings section, and Team
 * is gated on `team.manage`. But the database deliberately lets an owner name
 * ANY active member as their backup — the entire point of #332 is that
 * succession does not depend on rank — so the one person the mechanism exists
 * for is routinely a plain member, read-only or bookkeeper, and none of those
 * three get a Team row in any client's settings index. The recovery valve was
 * reachable on the web only by typing a URL, and on the phones not at all.
 *
 * The fix is NOT a new capability. `GET /v1/company/ownership` is already
 * mounted at `workspace.access` and already answers who-may-act as per-caller
 * booleans, precisely so that no client re-derives who may take a business.
 * What was missing was a PLACE. This module answers the one question every
 * such place has to agree on — "is there anything here for the person
 * reading?" — so three hand-written surfaces cannot drift into showing the
 * nominee nothing again.
 *
 * Hand-ported to SettingsLogic.kt and SettingsLogic.swift, with the same
 * vectors as the tests beside this file.
 */

/**
 * The caller's slice of GET /v1/company/ownership.
 *
 * Deliberately narrow: this decision reads the server's verdict and nothing
 * else. It never sees user ids, so it cannot start inventing its own answer to
 * "is this me?" — that question is settled in `viewFor()` on the server.
 */
export interface HandoverViewer {
  /** The server says this caller is the named backup and may start a claim. */
  can_claim: boolean;
  pending: {
    /** "offer" — the owner is handing it over. "claim" — the backup is taking it. */
    kind: string;
    /** This caller is the person it is addressed to. */
    mine: boolean;
    /** The waiting period is over. */
    ready: boolean;
  } | null;
}

/**
 * What the reader's own ownership surface leads with, or `null` when they are
 * not party to anything and the surface is just a status page.
 *
 * These are first-person states on purpose. The Team card speaks about other
 * people ("Ownership has been offered to Dana") because an owner is reading
 * about their crew; every one of these is read by the person it happens TO.
 */
export type HandoverPromptKind =
  /** An offer is open and addressed to them. */
  | "accept_offer"
  /** Their own claim outlasted the owner's veto window. */
  | "complete_claim"
  /** Their own claim is still inside it. */
  | "claim_waiting"
  /** They are the named backup and nothing is in flight. */
  | "backup_standing";

/**
 * The prompt this caller is owed, from the booleans the server sent.
 *
 * `can_claim` rather than `i_am_backup` for the standing state: they differ
 * exactly when something is already in flight, and the server's answer to "may
 * they act" is the one that must not be second-guessed.
 */
export function viewerHandoverPrompt(
  state: HandoverViewer,
): HandoverPromptKind | null {
  const pending = state.pending;
  if (pending && pending.mine) {
    if (!pending.ready) {
      // Only a claim can be theirs and unripe: an offer ripens the moment it
      // is made (api_offer_ownership sets ripens_at = now()), so a pending
      // offer addressed to somebody is always ready to accept.
      return "claim_waiting";
    }
    return pending.kind === "offer" ? "accept_offer" : "complete_claim";
  }
  return state.can_claim ? "backup_standing" : null;
}

/**
 * The one sentence the prompt leads with.
 *
 * Shared rather than written three times because this is the sentence that
 * tells somebody a business is being handed to them; a client wording it
 * differently is a client telling a workspace something subtly different about
 * what is happening to it.
 */
export function handoverPromptHeadline(kind: HandoverPromptKind): string {
  switch (kind) {
    case "accept_offer":
      return "You have been offered ownership of this workspace.";
    case "complete_claim":
      return "Your request to take over is ready to complete.";
    case "claim_waiting":
      return "You have asked to take over this workspace.";
    case "backup_standing":
      return "You are the backup owner.";
  }
}

/**
 * What the button that ends it says, to the person it is happening to.
 *
 * `handoverCancelLabel` (SettingsLogic) covers the Team card, where an owner
 * reads about their crew: "Stop this" is a veto and "Decline" is a refusal.
 * Neither fits a claimant reading about their OWN request — being told to
 * "decline" something you asked for is the app misreading the room. Returns
 * null for the standing nomination, which has nothing to call off.
 */
export function handoverPromptCancelLabel(
  kind: HandoverPromptKind,
): string | null {
  switch (kind) {
    case "accept_offer":
      return "Decline";
    case "complete_claim":
    case "claim_waiting":
      return "Withdraw my request";
    case "backup_standing":
      return null;
  }
}

/**
 * Whether the prompt is something to interrupt somebody with.
 *
 * Being the named backup is a standing arrangement that may sit unused for
 * years — surfacing it ambiently would be a permanent nag for a state that
 * needs no action. The other three are on a clock, so they are worth a banner.
 */
export function handoverPromptIsUrgent(kind: HandoverPromptKind): boolean {
  return kind !== "backup_standing";
}
