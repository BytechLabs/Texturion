/**
 * Where a fixture-writing dev script may send its writes: the local Supabase
 * stack, and nowhere else.
 *
 * Those scripts read SUPABASE_URL and SUPABASE_SECRET_KEY from the environment,
 * and an operator's shell can export the PRODUCTION pair for ops work. A local
 * seed run from that shell would create its users and workspace in production.
 */

export const LOCAL_SUPABASE_URL = "http://127.0.0.1:54321";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "host.docker.internal"]);

/** @param {string} url */
export function isLocalUrl(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return LOCAL_HOSTS.has(host) || host.endsWith(".localhost");
}

/**
 * The SUPABASE_URL to write to, or a thrown refusal when it is not local.
 *
 * The refusal never names the host, because CI logs on this public repository
 * are public too.
 *
 * @param {Record<string, string | undefined>} env
 */
export function localSupabaseUrl(env) {
  const url = env.SUPABASE_URL ?? LOCAL_SUPABASE_URL;
  if (!isLocalUrl(url)) {
    throw new Error(
      "SUPABASE_URL points at a remote host, and this script writes fixtures. " +
        "It only runs against the local stack (pnpm db:start). Unset " +
        "SUPABASE_URL and SUPABASE_SECRET_KEY in this shell, or point them at " +
        "the local stack.",
    );
  }
  return url;
}
