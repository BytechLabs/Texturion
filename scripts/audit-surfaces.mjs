/**
 * The surfaces both audits look at, and the one place that list lives.
 *
 * #238 asked for its accessibility check to share #320's capture "rather than
 * built twice", and the reason is not effort. Two copies of this array would
 * drift — one audit would gain the new screen and the other would not, and both
 * would keep reporting green while covering different products. Extracting it
 * makes that impossible rather than discouraged.
 *
 * `open` is a list of moves to perform before judging: a CSS selector to click,
 * or the sentinel `__cmdk__` for the command palette, which only opens by
 * keyboard. Portals are in here deliberately — a subtree rendered OUTSIDE
 * `.app-scope` is the one place the token cascade can break (#116), and it is
 * also where a focus trap is most likely to be missing.
 */
export const SURFACES = [
  // Marketing: its own palette, its own scope, and newly dark (#362 phase 8).
  { path: "/", label: "marketing home", auth: false },
  { path: "/pricing", label: "marketing pricing", auth: false },
  // #218 was literally "auth screens unreadable in light mode".
  { path: "/login", label: "login", auth: false },
  { path: "/signup", label: "signup", auth: false },
  // The authenticated shell, and then the PORTALS — #116's own ground.
  { path: "/for-you", label: "for-you (the post-login landing)", auth: true },
  { path: "/inbox", label: "inbox", auth: true },
  {
    path: "/inbox",
    label: "inbox · account menu (portal)",
    auth: true,
    // The see-through account surface IS the #116 bug. Opening it is the point:
    // this is the one entry here that audits a subtree rendered OUTSIDE
    // `.app-scope`, which is the only place the cascade fault can happen.
    open: ['[aria-label="Account and settings"]'],
  },
  {
    path: "/inbox",
    label: "inbox · command palette (portal)",
    auth: true,
    // A second portal, opened a different way (keyboard), because the account
    // menu and the palette mount through different Radix primitives.
    open: ["__cmdk__"],
  },
  { path: "/settings", label: "settings", auth: true },
  { path: "/tasks", label: "tasks", auth: true },
];
