"use client";

import { useEffect } from "react";

/**
 * #238 — when a Radix overlay hides the app behind it, make the app UNREACHABLE
 * as well as unannounced.
 *
 * ## The defect
 *
 * Opening a Radix dropdown, dialog or popover marks everything behind it
 * `aria-hidden="true"` (and stamps its own `data-aria-hidden` alongside). That
 * removes the app from the accessibility tree — and leaves every button, link
 * and field in it in the TAB ORDER.
 *
 * The result is a subtree that is focusable and unannounceable. A screen-reader
 * user who tabs into it hears nothing at all: focus is sitting on a control the
 * accessibility tree says does not exist. axe calls this `aria-hidden-focus` and
 * rates it serious; `check-app-a11y.mjs` found it on the account menu, which is
 * the menu holding sign-out.
 *
 * ## Why `inert` rather than a tabindex sweep
 *
 * `inert` is the one primitive that says both halves at once: not in the
 * accessibility tree, not in the tab order, not clickable. Walking the subtree
 * setting `tabindex="-1"` would mean restoring every original value on close,
 * and getting that wrong leaves controls permanently unreachable — a worse bug
 * than the one being fixed, and a silent one.
 *
 * ## Why this watches an attribute instead of hooking each overlay
 *
 * Radix decides when to hide the background, per overlay, in library code. A
 * wrapper-by-wrapper fix would have to be repeated on every dropdown, dialog,
 * popover and sheet in the product, and the next one somebody adds would not
 * have it. Watching for the attribute Radix already sets covers all of them,
 * including the ones not written yet.
 *
 * The overlays themselves are portalled to `document.body`, OUTSIDE the element
 * being marked, so making it inert never disables the menu the person is
 * actually using. That is precisely the arrangement `inert` exists for.
 *
 * Mounted once in the app layout. Removing the attribute removes `inert` again,
 * so nothing survives the overlay closing.
 */
export function InertWhileAriaHidden() {
  useEffect(() => {
    const sync = () => {
      for (const element of document.querySelectorAll("[data-aria-hidden='true']")) {
        if (element instanceof HTMLElement && !element.inert) element.inert = true;
      }
      // Anything we made inert that Radix has since released. Keyed on the
      // attribute rather than on remembered nodes, so a fast open/close pair
      // cannot leave the app inert with no overlay on screen — which would
      // lock the whole page out of the keyboard.
      for (const element of document.querySelectorAll("[inert]")) {
        if (
          element instanceof HTMLElement &&
          element.getAttribute("data-aria-hidden") !== "true"
        ) {
          element.inert = false;
        }
      }
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-aria-hidden"],
    });
    return () => {
      observer.disconnect();
      // Leaving the page inert on unmount would be the worst possible exit.
      for (const element of document.querySelectorAll("[inert]")) {
        if (element instanceof HTMLElement) element.inert = false;
      }
    };
  }, []);

  return null;
}
