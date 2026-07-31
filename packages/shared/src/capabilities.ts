/**
 * #315 — the axes a role is actually made of.
 *
 * `requireRole` implements a strict RANK: owner ⊃ admin ⊃ member. It is clean,
 * correctly enforced, and one-dimensional — and the people in a real crew are
 * not arranged on a line. The bookkeeper needs billing and NOT every customer
 * conversation; a read-only observer needs conversations and NOT the ability to
 * text as the business. Neither is expressible as a rank, so today the answer
 * is "make them an admin", and the practical outcome is a shared login — which
 * defeats #191 attribution, #231 audit and #314 MFA at the same time.
 *
 * This is the model those presets will be built from. It changes NO behaviour
 * on its own: the three existing roles are defined here as the exact capability
 * sets their rank already implies, and `capabilities.test.ts` proves the
 * equivalence case by case rather than asserting it in a comment. That
 * equivalence is the whole point of landing this separately — the conversion of
 * 138 `requireRole` gates is only safe if the model provably says what the rank
 * says today.
 *
 * Deliberately NOT a permission matrix. #315's own discipline: "a checkbox grid
 * is a correct model and a bad product for a two-person plumbing company." The
 * capabilities below are the axes an owner already thinks in; roles stay named
 * presets over them, and per-capability configuration waits for a customer who
 * asks for it.
 */

/**
 * What someone can DO, split along the lines that are genuinely independent.
 *
 * Split rules, so the next person adding one has a test to apply:
 * - Two capabilities are separate when a real crew member needs one and not
 *   the other. The bookkeeper is why `billing.manage` is not `settings.manage`.
 * - Reading and acting are separate wherever acting is visible to a CUSTOMER.
 *   That is why `conversations.read` and `conversations.send` are two things:
 *   the read-only observer is exactly the gap between them.
 * - Anything that spends money, ends the workspace, or moves the number is
 *   owner-only and stays that way. Those are not delegation problems.
 */
export const CAPABILITIES = [
  /**
   * You belong to this workspace at all: the company record the app boots on,
   * your own notification preferences, your push subscriptions, leaving.
   *
   * Every role has it, including presets that hold no inbox access — without a
   * baseline the app cannot even load for them, and a role that cannot boot is
   * not a role.
   */
  "workspace.access",
  /** See conversations, contacts, tasks — the shared inbox, read side. */
  "conversations.read",
  /** Send a text, place a call: act as the business toward a customer. */
  "conversations.send",
  /** Post internal notes. Separate from `send` because a note reaches nobody
   *  outside the crew, which is what makes note-only access useful (#106 has
   *  the same 'text' vs 'note' split per number). */
  "conversations.note",
  /** Plan, payment method, invoices, receipts. */
  "billing.manage",
  /** Workspace settings: hours, away reply, calling, Lou, templates. */
  "settings.manage",
  /** Invite, remove, and re-role teammates. */
  "team.manage",
  /** Buy, release, port and register numbers; per-number access rules. */
  "numbers.manage",
  /** Read the audit log (#231). */
  "history.read",
  /**
   * Move the customer list in or out in bulk: CSV/vCard import, and the export
   * job. Its own axis because #231 names bulk export "the departing-employee
   * signature" — it is the one capability whose misuse looks nothing like
   * ordinary inbox work, and nobody who only does the books should carry it.
   */
  "contacts.bulk",
  /**
   * The irreversible ones: the overage cap, US enablement, number release,
   * transferring ownership, closing the workspace. Owner only, and not part of
   * any preset — a capability nobody can be granted is the honest way to say
   * "this is the owner's alone".
   */
  "workspace.own",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** The roles that exist today. New presets are added here, not invented at a
 *  call site. */
export const MEMBER_ROLES = [
  "owner",
  "admin",
  "member",
  "read_only",
  "bookkeeper",
] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/**
 * Each role's capabilities, set to EXACTLY what its rank grants today.
 *
 * owner ⊃ admin ⊃ member is preserved here as data rather than arithmetic,
 * which is what lets a later preset break the line without breaking these.
 */
const ROLE_CAPABILITIES: Record<MemberRole, readonly Capability[]> = {
  /**
   * #315: the observer with no approximation before this — an owner's partner,
   * an accountant, a consultant who should SEE the work and never text a
   * customer as the business.
   *
   * A SET, not a rung. It is deliberately NOT on the owner ⊃ admin ⊃ member
   * line, so `roleSatisfiesRank` refuses it everywhere: any gate that still
   * asked for a rank would keep saying no rather than quietly admitting it.
   * That is only safe because all 137 gates moved to axes first.
   */
  read_only: ["workspace.access", "conversations.read"],
  /**
   * #315: the bookkeeper or spouse doing the books. THE case that issue names
   * as the one to solve first, because it is the one currently forcing
   * credential sharing: the only way to hand somebody billing today is to make
   * them an admin, which also hands them every customer conversation in the
   * business. So the owner shares their own login instead, and #191
   * attribution, #231 audit and #314 MFA stop meaning anything at once.
   *
   * Billing and NOT the inbox. No conversations.read at all — this is the one
   * role that never sees a customer, which is also why it needed a landing of
   * its own: every primary surface in the app is a conversation surface.
   */
  bookkeeper: ["workspace.access", "billing.manage"],
  member: [
    "workspace.access",
    "conversations.read",
    "conversations.send",
    "conversations.note",
  ],
  admin: [
    "workspace.access",
    "conversations.read",
    "conversations.send",
    "conversations.note",
    "billing.manage",
    "settings.manage",
    "team.manage",
    "numbers.manage",
    "history.read",
    "contacts.bulk",
  ],
  owner: [...CAPABILITIES],
};

/**
 * Does this role carry this capability?
 *
 * An UNKNOWN role carries nothing. That case is real rather than theoretical:
 * the database enum can grow a value ahead of a deployed client, and a role
 * arrives here as data from a row. Indexing the table blindly threw a
 * TypeError, which a gate turns into a 500 — an error page where the honest
 * answer is "no". Fail closed.
 */
export function roleHasCapability(role: MemberRole, capability: Capability): boolean {
  return (ROLE_CAPABILITIES[role] ?? []).includes(capability);
}

/** Everything this role can do. Copied, so a caller cannot mutate the table;
 *  empty for a role this build has never heard of (see above). */
export function capabilitiesOf(role: MemberRole): Capability[] {
  return [...(ROLE_CAPABILITIES[role] ?? [])];
}

/**
 * The rank `requireRole` uses today, kept so the equivalence test can compare
 * the two models directly. New presets that are not on the line must NOT be
 * given a rank — that is the point of moving off it.
 */
const RANK: Partial<Record<MemberRole, number>> = {
  member: 1,
  admin: 2,
  owner: 3,
};

/** Today's gate, expressed exactly: does `role` satisfy `requireRole(minimum)`? */
export function roleSatisfiesRank(
  role: MemberRole,
  minimum: MemberRole,
): boolean {
  // Same fail-closed rule: a role with no rank satisfies no rank gate, which
  // is exactly what an off-the-line preset should do at an unconverted route.
  const rank = RANK[role];
  const floor = RANK[minimum];
  return rank !== undefined && floor !== undefined && rank >= floor;
}
