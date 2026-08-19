/** @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LanguageSwitch } from "./language-switch";

/**
 * D138 Rule 6 — the switcher offers only what exists, and goes to the page you
 * were reading.
 *
 * Two failures it exists to prevent, both of which are worse than having no
 * switcher at all:
 *
 * - **Offering French on a page with none.** The next click is a 404 under
 *   Rule 4, so the control would be a promise the site immediately breaks.
 * - **Bouncing to the front page.** Somebody on `/fr/contact` who switches
 *   wants `/contact`. Landing them on `/` throws away what they were reading
 *   and makes them find it again in a language they just told us they prefer.
 */

const pathname = { current: "/contact" };
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

afterEach(cleanup);

describe("the language switch", () => {
  it("offers French on a page that has French", () => {
    pathname.current = "/contact";
    render(<LanguageSwitch />);
    const link = screen.getByRole("link", { name: "Français" });
    expect(link.getAttribute("href")).toBe("/fr/contact");
  });

  it("offers English from the French page, back to the same page", () => {
    pathname.current = "/fr/contact";
    render(<LanguageSwitch />);
    const link = screen.getByRole("link", { name: "English" });
    // Not "/" — the whole point of the rule.
    expect(link.getAttribute("href")).toBe("/contact");
  });

  it("renders nothing at all where there is no translation", () => {
    // Absent rather than disabled: a greyed-out toggle tells a Quebec reader
    // the French exists and they are not allowed it.
    pathname.current = "/pricing";
    const { container } = render(<LanguageSwitch />);
    expect(container.innerHTML).toBe("");
  });

  it("names the destination language in that language", () => {
    // "Français" is the only word on an English page a French reader is
    // guaranteed to understand, which is the whole reason it is not "French".
    pathname.current = "/contact";
    render(<LanguageSwitch />);
    expect(screen.queryByText("French")).toBeNull();
    expect(screen.getByText("Français")).toBeTruthy();
  });

  it("marks the link's own language so it is pronounced correctly", () => {
    // The label is in a different language from the page around it. Without
    // `lang`, a screen reader says "Français" with an English voice — the one
    // word on the page that has to be right to be useful.
    pathname.current = "/contact";
    render(<LanguageSwitch />);
    const link = screen.getByRole("link", { name: "Français" });
    expect(link.getAttribute("lang")).toBe("fr-CA");
    expect(link.getAttribute("hreflang")).toBe("fr-CA");
  });
});
