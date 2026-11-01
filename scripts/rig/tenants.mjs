/**
 * The rig's tenants, as data the seed and the scenarios share. Numbers are
 * named by role; the real ones come from the guard.
 *
 * `rings` is each number's ring audience at rest: the fewest surfaces the
 * scheduled scenarios need. A scenario that needs more adds them under its
 * run lease, and the lease's undo removes them; the seed puts them back here.
 * Owners always ring where they have a surface (#106 never restricts an
 * owner), so an owner with none, like QA-A's, rings nothing.
 *
 * A tenant with no standing number names `messagingProfile`, the guard's own
 * profile for it (a key in telnyx-spec.json), and `anchor`, a standing role
 * whose area code it buys in. The profile is the tenant's alone, because a
 * company's messaging profile is unique, so a number it buys lands in the
 * partition without the app creating a profile.
 */

export const TENANTS = [
  {
    key: "qa-w",
    name: "QA-W",
    // Owner and technician sign in on the rig's Chromium; the other two are
    // API only and never ring.
    members: [
      { key: "owner", role: "owner", displayName: "QA-W Owner", surfaces: ["chromium"] },
      { key: "technician", role: "member", displayName: "QA-W Technician", surfaces: ["chromium"] },
      { key: "note-member", role: "member", displayName: "QA-W Note Member", surfaces: [] },
      { key: "mfa-member", role: "member", displayName: "QA-W Two-Factor Member", surfaces: [], totp: true },
    ],
    numbers: [
      { role: "DEV-W1", rings: ["owner"] },
      { role: "DEV-W2", rings: ["owner", "technician"] },
    ],
    callerIdLookup: false,
  },
  {
    key: "qa-a",
    name: "QA-A",
    // The dispatcher rings only when a scenario's lease adds it. The
    // technician's `pixel` surface is the device-lane emulator, the AVD
    // rig-pixel (a Pixel 8 profile), not a physical phone.
    members: [
      { key: "technician", role: "member", displayName: "QA-A Technician", surfaces: ["pixel"] },
      { key: "dispatcher", role: "member", displayName: "QA-A Dispatcher", surfaces: ["chrome"] },
      { key: "owner", role: "owner", displayName: "QA-A Owner", surfaces: [] },
    ],
    numbers: [{ role: "DEV-A1", rings: ["technician"] }],
    callerIdLookup: true,
  },
  {
    key: "qa-c",
    name: "QA-C",
    members: [
      { key: "owner", role: "owner", displayName: "QA-C Owner", surfaces: ["chromium"] },
      { key: "signout-member", role: "member", displayName: "QA-C Sign-out Member", surfaces: ["chromium"] },
    ],
    numbers: [{ role: "DEV-C1", rings: ["owner"] }],
    callerIdLookup: false,
  },
  {
    key: "qa-g",
    name: "QA-G",
    // The grace workspace. S28 buys the monthly number into it through the
    // app and S29 runs it through cancellation, grace and release the next
    // day. Grace releases every number a workspace holds, so it holds no
    // standing number: a standing one here would be released, or refused by
    // the guard, which stops grace before it deactivates anything.
    members: [{ key: "owner", role: "owner", displayName: "QA-G Owner", surfaces: ["chromium"] }],
    numbers: [],
    messagingProfile: "qa-g",
    anchor: "DEV-C1",
    callerIdLookup: false,
  },
  {
    key: "qa-e",
    name: "QA-E",
    members: [{ key: "owner", role: "owner", displayName: "QA-E Emulator Member", surfaces: ["emulator"] }],
    numbers: [{ role: "DEV-E1", rings: ["owner"] }],
    callerIdLookup: false,
  },
  {
    key: "robot",
    name: "Robot",
    // No person. The workspace exists so the rig's own number sweep knows the
    // robot's numbers instead of flagging them as orphans every 15 minutes;
    // the owner is a placeholder account that never signs in. Telnyx routes
    // these numbers to the robot's own connection, never to the app.
    members: [{ key: "owner", role: "owner", displayName: "Rig Robot", surfaces: [] }],
    numbers: [
      { role: "ROBOT-1", rings: [], voice: false },
      { role: "ROBOT-2", rings: [], voice: false },
      { role: "STRANGER-1", rings: [], voice: false },
    ],
    callerIdLookup: false,
  },
];

/**
 * Where every member's mail lands: Resend's test sink, which the guard allows
 * and which costs the sending domain nothing. Auth mail goes to the stack's
 * Mailpit whatever the address.
 */
export function memberEmail(tenantKey, memberKey) {
  return `delivered+rig-${tenantKey}-${memberKey}@resend.dev`;
}
