/**
 * #243 — scoped API keys, and what they may reach.
 *
 * The issue's constraint is the design: *"Never a bearer of full account
 * power."* So there is no `admin` scope, no `*`, and nothing here reaches
 * billing, the team roster, phone-number configuration, or the workspace's own
 * settings. A leaked key is a data-access incident, which is bad; it is not an
 * account takeover, which is unrecoverable.
 *
 * The vocabulary is deliberately small — #243 asks for "the ten calls an
 * integrator actually needs", not the internal API. Every scope added here is
 * a promise that cannot be withdrawn without breaking somebody's connector.
 */

/**
 * What a key may do, by resource and direction.
 *
 * Read and write are separate for every resource, because the common
 * integration is one-way. A scheduling tool that creates jobs needs
 * `tasks:write` and nothing else; a reporting dashboard needs reads and should
 * be unable to send a text to a customer even if its host is compromised.
 *
 * `messages:send` is its own scope rather than part of `conversations:write`
 * for the same reason, and a stronger one: it is the only scope in this list
 * that can make the workspace's number appear on a stranger's phone. Somebody
 * granting a key the right to read threads should have to decide separately
 * whether it may also speak.
 */
export const API_KEY_SCOPES = [
  "conversations:read",
  "messages:read",
  "messages:send",
  "contacts:read",
  "contacts:write",
  "tasks:read",
  "tasks:write",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return (API_KEY_SCOPES as readonly string[]).includes(value);
}

/**
 * The catalogue key naming a scope to a human.
 *
 * Derived from the scope itself rather than listed, so a new scope arrives in
 * the UI as a missing key rather than as `contacts:write` on a customer's
 * screen — and so the mapping cannot drift from the vocabulary the way a
 * hand-written table does.
 */
export function apiKeyScopeLabelKey(scope: ApiKeyScope): string {
  const camel = scope.replace(/:(\w)/g, (_, c: string) => c.toUpperCase());
  return `apiKeys.scope.${camel}`;
}

/**
 * The prefix every token carries.
 *
 * Not decoration. A prefix is what makes a leaked key findable by a secret
 * scanner — ours, GitHub's, and the customer's own — and what lets a human
 * looking at a config file tell whose credential it is. It is also what the
 * server matches on before doing any database work, so a pasted password never
 * reaches a lookup.
 */
export const API_KEY_PREFIX = "lnx_";

/**
 * How much of a token is stored in the clear so the UI can identify it.
 *
 * The prefix plus the first eight characters — enough for somebody holding
 * three keys to tell which is which, far short of enough to guess the rest.
 * The remainder exists only as a hash.
 */
export const API_KEY_DISPLAY_CHARS = API_KEY_PREFIX.length + 8;

/** Random bytes behind the prefix. 32 is 256 bits; guessing is not a threat. */
export const API_KEY_SECRET_BYTES = 32;

/**
 * Keys per workspace.
 *
 * A cost and blast-radius bound rather than a style rule: every live key is
 * another credential that can be leaked, and a workspace with fifty of them
 * cannot tell which one to revoke. Ten is well past one-per-integration.
 */
export const API_KEY_CAP = 10;

/**
 * Requests per minute, per key.
 *
 * #243 item 4: "An integration that polls every second must cost the workspace
 * something or it costs us." This is the ceiling that makes that true, and it
 * is generous for anything event-driven — a connector that needs more than one
 * request a second is polling, and polling is what webhooks replaced.
 */
export const API_KEY_REQUESTS_PER_MINUTE = 60;

/**
 * Does this key's scope set permit this operation?
 *
 * A plain containment check, exported so the route gate and any client-side
 * explanation answer from the same function. There is no hierarchy — holding
 * `contacts:write` does not imply `contacts:read`, because a key that may
 * create a contact has no business enumerating the customer list, and an
 * implication table is where least privilege quietly stops being least.
 */
export function apiKeyAllows(
  granted: readonly string[],
  required: ApiKeyScope,
): boolean {
  return granted.includes(required);
}

/**
 * The version every public route is served under, and the first half of the
 * compatibility promise #243 asks for on day one.
 *
 * A public API is a promise; shipping one without a stated policy means the
 * first breaking change is a support incident. The path carries the version so
 * that a v2 can exist beside v1 rather than replacing it under somebody's
 * running integration.
 */
export const PUBLIC_API_VERSION = "v1";
export const PUBLIC_API_BASE = `/public/${PUBLIC_API_VERSION}`;

/**
 * The header a response carries to say which version answered.
 *
 * Cheap, and it is what turns "our integration broke" into a report with a
 * fact in it. A client that pins nothing still gets told what it got.
 */
export const PUBLIC_API_VERSION_HEADER = "loonext-api-version";
