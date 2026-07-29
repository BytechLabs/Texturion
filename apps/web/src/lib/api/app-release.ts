/**
 * #339 — what the server recommends, and what it insists on.
 *
 * Read from the PUBLIC `/app-release` endpoint, deliberately not through the
 * authenticated client: the reason to demand an update may be that auth is
 * broken in this very build (#268 signs the user out on a transient refresh
 * failure). A policy fetched with a bearer token is a policy the affected
 * client cannot read.
 *
 * Every failure path resolves to "no policy", which every consumer treats as
 * "ask nothing". A network blip must never become an update wall.
 */
import { updateRequirement, type AppReleasePolicy, type UpdateRequirement } from "@loonext/shared";
import { useQuery } from "@tanstack/react-query";

/** This build, injected from package.json at build time (next.config.ts). */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? null;

/**
 * Fetch the policy. Never throws — a rejected promise here would surface as an
 * error state that some consumer eventually renders, and the only correct
 * render for "we could not ask" is nothing at all.
 */
async function fetchPolicy(): Promise<AppReleasePolicy | null> {
  try {
    // Read the inlined var directly rather than through the validated
    // `publicEnv`, whose module-level parse throws on import. This feature is
    // fail-open by construction: a missing origin means no policy, which means
    // no demands. Importing a validator into the app shell to reach a fail-open
    // endpoint would make a config mistake louder than the feature it guards.
    const origin = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
    if (!origin) return null;

    const response = await fetch(`${origin}/app-release?platform=web`, {
      // No credentials: the endpoint is public, and sending them would be the
      // one thing that could make it fail for the clients that need it most.
      credentials: "omit",
    });
    if (!response.ok) return null;
    return (await response.json()) as AppReleasePolicy;
  } catch {
    return null;
  }
}

/**
 * The policy, refreshed hourly.
 *
 * Hourly rather than per-navigation because the endpoint is edge-cached for
 * five minutes anyway and the answer changes a few times a year. A session
 * left open for a day still learns about a floor raised that morning.
 */
export function useAppRelease() {
  return useQuery({
    queryKey: ["app-release", "web"],
    queryFn: fetchPolicy,
    staleTime: 60 * 60 * 1000,
    refetchInterval: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    // A failed fetch is already "no policy"; retrying would only delay that.
    retry: false,
  });
}

/** What this build should do about itself: "none" | "soft" | "block". */
export function useUpdateRequirement(): UpdateRequirement {
  const { data } = useAppRelease();
  return updateRequirement(APP_VERSION, data ?? null);
}
