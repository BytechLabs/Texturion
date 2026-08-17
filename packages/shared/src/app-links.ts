/**
 * #613 — which https paths on this domain the native apps may take from the
 * browser.
 *
 * ## The problem this list exists to prevent
 *
 * A universal link is a claim, and the claim is total: an app that says it
 * handles a path handles it for everybody, and the browser never sees the tap.
 * Get the list too wide and you have taken a page away from the only client
 * that can render it — `/q/<token>` is the sharpest example, a customer's quote
 * page opened from a text on a phone that may well have the crew app installed.
 * Handing that to an app the customer cannot log into is a dead end with no
 * error and no way back.
 *
 * So the rule is: a path belongs here only when EVERY app claiming it resolves
 * it to a specific thing. Not "the app has a screen roughly about this" — the
 * router turns the URL into an object, or the path stays with the browser.
 *
 * ## Why the paths and the routers are checked against each other
 *
 * The routers are hand-written per platform (`deepLinkFor` in Kotlin,
 * `parsePushRoute` in Swift) and this list is served from a third place. Three
 * copies of one rule drift, and the drift is silent in both directions: a path
 * claimed here that no router understands is a tap that opens the app and lands
 * nowhere, and a path a router understands but nobody claims is the bug this
 * issue was filed about — a feature built, routed, and never switched on.
 * `app-links.test.ts` reads all three and asserts they are one list.
 *
 * ## What is deliberately NOT here
 *
 * `/settings/*`, which Android's router alone understands. It resolves an
 * unrecognised section to the settings hub rather than to nothing — good
 * behaviour for a push we send ourselves, and the wrong behaviour for a link
 * somebody followed: the web has settings pages the app has no screen for, and
 * claiming the prefix would answer a specific request with a general screen.
 *
 * `/q/<token>` and every marketing path, for the reason above.
 */

/**
 * The first path segment of each claimable surface, and the shared vocabulary
 * the per-platform routers are checked against.
 *
 * `conversations` and `inbox` are the same surface under two names — the server
 * has sent both in push payloads, and both resolve to a thread.
 */
export const APP_LINK_SEGMENTS = [
  "inbox",
  "conversations",
  "tasks",
  "calls",
] as const;

export type AppLinkSegment = (typeof APP_LINK_SEGMENTS)[number];

/**
 * The path patterns in Apple's `components` grammar.
 *
 * `/calls` appears twice on purpose: bare, because the calls list is a real
 * destination on its own (a ring-wake link carries the session in `?call=`),
 * and prefixed, because #336 made `/calls/<session>` a permalink. A lone
 * `/calls/*` would miss the first and a lone `/calls` would miss the second.
 */
export const APPLE_APP_LINK_COMPONENTS: readonly string[] = [
  "/inbox/*",
  "/conversations/*",
  "/tasks/*",
  "/calls",
  "/calls/*",
];

/**
 * The same claim in Android's manifest grammar, where a filter is a set of
 * `<data>` elements rather than a list of patterns.
 *
 * `pathPrefix="/calls"` would also match `/callsomething`, so the bare form is
 * an exact `path` and the permalink form carries its own trailing slash.
 */
export const ANDROID_APP_LINK_PATHS: readonly {
  kind: "path" | "pathPrefix";
  value: string;
}[] = [
  { kind: "pathPrefix", value: "/inbox/" },
  { kind: "pathPrefix", value: "/conversations/" },
  { kind: "pathPrefix", value: "/tasks/" },
  { kind: "path", value: "/calls" },
  { kind: "pathPrefix", value: "/calls/" },
];

/**
 * The host the apps claim. Matches the `applinks:` entitlement in
 * `apps/ios/project.yml` and the `android:host` in the manifest.
 *
 * A CONSTANT rather than configuration, unlike the app identifiers beside it in
 * `app-association.ts`. Those are secrets-shaped values that do not exist until
 * a store issues them; this is the address of the product, and it is compiled
 * into both binaries either way — pretending it can be swapped at deploy time
 * would be a lie the manifest cannot keep.
 */
export const APP_LINK_HOST = "app.loonext.com";
