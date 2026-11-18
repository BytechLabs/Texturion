/**
 * G9 unread indicator logic: the `(3) Inbox — Loonext` title formatting, the
 * stateful title controller (which must never mangle page-authored titles),
 * and favicon selection.
 */
import { describe, expect, it } from "vitest";

import {
  createTitleController,
  faviconHref,
  formatUnreadTitle,
} from "./title";

describe(formatUnreadTitle, () => {
  it("prefixes the count in the G9 shape", () => {
    expect(formatUnreadTitle("Inbox — Loonext", 3)).toBe("(3) Inbox — Loonext");
  });

  it("leaves the title alone at zero unread", () => {
    expect(formatUnreadTitle("Inbox — Loonext", 0)).toBe("Inbox — Loonext");
    expect(formatUnreadTitle("Inbox — Loonext", -1)).toBe("Inbox — Loonext");
  });

  it("caps the display at 99+", () => {
    expect(formatUnreadTitle("Inbox — Loonext", 99)).toBe(
      "(99) Inbox — Loonext",
    );
    expect(formatUnreadTitle("Inbox — Loonext", 100)).toBe(
      "(99+) Inbox — Loonext",
    );
  });
});

describe(createTitleController, () => {
  it("applies and updates the prefix without stacking", () => {
    const controller = createTitleController();
    expect(controller.next("Inbox — Loonext", 3)).toBe("(3) Inbox — Loonext");
    // Count changes over its own output keep the original base.
    expect(controller.next("(3) Inbox — Loonext", 5)).toBe(
      "(5) Inbox — Loonext",
    );
    expect(controller.next("(5) Inbox — Loonext", 0)).toBe("Inbox — Loonext");
  });

  it("treats any unrecognized title as a fresh page-authored base", () => {
    const controller = createTitleController();
    controller.next("Inbox — Loonext", 2);
    // Route change → new title written by the page.
    expect(controller.next("Contacts — Loonext", 2)).toBe(
      "(2) Contacts — Loonext",
    );
  });

  it("never mangles page titles that legitimately start with parentheses", () => {
    // A thread with an unnamed contact titles itself with the formatted
    // number (G10) — a regex stripper would eat "(416) ".
    const controller = createTitleController();
    expect(controller.next("(416) 555-0182 — Loonext", 2)).toBe(
      "(2) (416) 555-0182 — Loonext",
    );
    expect(controller.next("(2) (416) 555-0182 — Loonext", 0)).toBe(
      "(416) 555-0182 — Loonext",
    );
  });

  it("restores its own prefix on unmount but leaves foreign titles alone", () => {
    const controller = createTitleController();
    controller.next("Inbox — Loonext", 4);
    expect(controller.restore("(4) Inbox — Loonext")).toBe("Inbox — Loonext");
    // The page changed the title after our last write — hands off.
    expect(controller.restore("Settings — Loonext")).toBe(
      "Settings — Loonext",
    );
  });
});

describe(faviconHref, () => {
  it("selects the dotted favicon only while unread exists", () => {
    expect(faviconHref(0)).toBe("/favicon.svg");
    expect(faviconHref(1)).toBe("/favicon-unread.svg");
  });
});
