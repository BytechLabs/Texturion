/**
 * #315: what the primary nav shows a role that has no inbox.
 *
 * Every focus surface in this app is a conversation surface, so the bookkeeper
 * preset — billing and nothing else — is the first role that can produce an
 * EMPTY sidebar. An empty nav reads as a broken app, and the 403s behind those
 * five rows would read as a broken account.
 */
import { describe, expect, it } from "vitest";

import { MEMBER_ROLES, type MemberRole } from "@loonext/shared";

import { navRowsFor } from "./sidebar";

describe("navRowsFor", () => {
  it("gives every role something to open", () => {
    // The property that matters most: whatever roles exist now or later, none
    // of them lands in an app with no navigation.
    for (const role of MEMBER_ROLES) {
      expect(navRowsFor(role).length, `${role} has an empty nav`).toBeGreaterThan(
        0,
      );
    }
  });

  it("shows the crew the five focus surfaces", () => {
    for (const role of ["owner", "admin", "member"] as MemberRole[]) {
      const hrefs = navRowsFor(role).map((row) => row.href);
      expect(hrefs, role).toEqual([
        "/for-you",
        "/inbox",
        "/calls",
        "/tasks",
        "/contacts",
      ]);
    }
  });

  it("shows a view-only observer the same surfaces — they can read them all", () => {
    // read_only differs from a member in what it can DO, not in what it sees,
    // so hiding rows from it would be a second, contradictory answer to a
    // question the composer already answers honestly.
    expect(navRowsFor("read_only").map((r) => r.href)).toEqual(
      navRowsFor("member").map((r) => r.href),
    );
  });

  it("sends a bookkeeper to billing, and nowhere near a conversation", () => {
    const rows = navRowsFor("bookkeeper");
    expect(rows.map((r) => r.href)).toEqual(["/settings/billing"]);
    // The whole point of the role: no route into the inbox from the primary
    // nav, because there is nothing behind it for them.
    for (const row of rows) {
      expect(row.href.startsWith("/inbox")).toBe(false);
      expect(row.href.startsWith("/contacts")).toBe(false);
    }
  });

  it("never offers a row the role cannot open", () => {
    // The inverse of the empty-nav check, and the one that would catch a new
    // row added without a capability.
    for (const role of MEMBER_ROLES) {
      for (const row of navRowsFor(role)) {
        expect(row.needs, `${role} → ${row.href}`).toBeTruthy();
      }
    }
  });
});
