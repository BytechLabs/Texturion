import type { Env } from "../env";
import { getCalendarProviderConfiguration } from "./config";
import {
  openCalendarCredential,
  sealCalendarCredential,
  type SealedCalendarCredential,
} from "./crypto";
import {
  GoogleCalendarProvider,
  refreshGoogleAccessToken,
} from "./providers/google";
import {
  MicrosoftCalendarProvider,
  refreshMicrosoftAccessToken,
} from "./providers/microsoft";
import {
  CalendarProviderError,
  type CalendarFetch,
  type CalendarProvider,
  type CalendarProviderName,
} from "./providers/types";

export interface CalendarCredentialConnection {
  id: string;
  company_id: string;
  user_id: string;
  provider: CalendarProviderName;
  credential_generation: number;
}

export interface CalendarCredentialMutationResult {
  outcome: string;
  credential_generation?: number;
}

export interface CalendarCredentialClaimResult
  extends CalendarCredentialMutationResult {
  credential_ciphertext?: string | null;
  credential_iv?: string | null;
  credential_key_version?: string | null;
}

export interface CalendarCredentialRefreshStore {
  claimCredentialRefresh(input: {
    connection: CalendarCredentialConnection;
    workerId: string;
    leaseSeconds: number;
  }): Promise<CalendarCredentialClaimResult>;
  commitCredentialRefresh(input: {
    connectionId: string;
    workerId: string;
    expectedGeneration: number;
    credential: SealedCalendarCredential;
  }): Promise<CalendarCredentialMutationResult>;
  retryCredentialRefresh(input: {
    connectionId: string;
    workerId: string;
    expectedGeneration: number;
    requiresReauth: boolean;
    errorCode: string;
    errorDetail: string;
  }): Promise<CalendarCredentialMutationResult>;
}

export class CalendarCredentialRefreshUnavailableError extends Error {
  constructor(
    readonly outcome: "busy" | "not_found" | "superseded" | "lease_lost",
  ) {
    super(`calendar credential refresh is ${outcome}`);
    this.name = "CalendarCredentialRefreshUnavailableError";
  }
}

const CREDENTIAL_COMMIT_ATTEMPTS = 3;

function credentialErrorCode(error: unknown): string {
  if (error instanceof CalendarProviderError) {
    return `${error.provider}_${error.kind}`.slice(0, 100);
  }
  return "calendar_credential_refresh_failed";
}

function credentialErrorDetail(error: unknown): string {
  return error instanceof Error
    ? error.message.slice(0, 1_000)
    : "Unknown calendar credential refresh error";
}

function credentialClaim(
  result: CalendarCredentialClaimResult,
): {
  generation: number;
  credential: SealedCalendarCredential;
} {
  if (
    result.outcome !== "claimed" ||
    !Number.isSafeInteger(result.credential_generation) ||
    result.credential_generation! < 1 ||
    typeof result.credential_ciphertext !== "string" ||
    typeof result.credential_iv !== "string" ||
    typeof result.credential_key_version !== "string"
  ) {
    throw new Error("calendar credential refresh claim is malformed");
  }
  return {
    generation: result.credential_generation!,
    credential: {
      ciphertext: result.credential_ciphertext,
      iv: result.credential_iv,
      keyVersion: result.credential_key_version,
    },
  };
}

function providerFor(
  name: CalendarProviderName,
  fetcher: CalendarFetch,
): CalendarProvider {
  return name === "google"
    ? new GoogleCalendarProvider(fetcher)
    : new MicrosoftCalendarProvider(fetcher);
}

/**
 * Refresh one provider token under the database credential lease.
 *
 * The access token is returned only after the rotated refresh credential is
 * durably committed for the generation that was claimed. OAuth reconnect and
 * disconnect both advance that generation, so a stale request can neither
 * overwrite the new credential nor continue using an access token minted from
 * the superseded account.
 */
export async function authorizeCalendarConnection(input: {
  env: Env;
  store: CalendarCredentialRefreshStore;
  connection: CalendarCredentialConnection;
  workerId: string;
  leaseSeconds?: number;
  fetcher?: CalendarFetch;
}): Promise<{ accessToken: string; provider: CalendarProvider }> {
  const fetcher = input.fetcher ?? fetch;
  const claimed = await input.store.claimCredentialRefresh({
    connection: input.connection,
    workerId: input.workerId,
    leaseSeconds: input.leaseSeconds ?? 120,
  });
  if (
    claimed.outcome === "busy" ||
    claimed.outcome === "not_found" ||
    claimed.outcome === "superseded"
  ) {
    throw new CalendarCredentialRefreshUnavailableError(claimed.outcome);
  }
  const claim = credentialClaim(claimed);
  const configuration = getCalendarProviderConfiguration(
    input.env,
    input.connection.provider,
  );
  const context = {
    companyId: input.connection.company_id,
    userId: input.connection.user_id,
    provider: input.connection.provider,
    purpose: "refresh_token" as const,
  };
  let stage: "open" | "refresh" | "seal" | "commit" = "open";
  let ownsLease = true;
  try {
    const current = await openCalendarCredential(
      claim.credential,
      context,
      configuration.keyring,
    );
    stage = "refresh";
    const tokens = input.connection.provider === "google"
      ? await refreshGoogleAccessToken(fetcher, configuration.oauth, current)
      : await refreshMicrosoftAccessToken(
          fetcher,
          configuration.oauth,
          current,
          configuration.tenant,
        );
    if (!tokens.refreshToken) {
      throw new Error("calendar provider omitted the refresh token");
    }
    stage = "seal";
    const rotated = await sealCalendarCredential(
      tokens.refreshToken,
      context,
      configuration.keyring,
    );
    stage = "commit";
    let lastCommitError: unknown;
    for (let attempt = 0; attempt < CREDENTIAL_COMMIT_ATTEMPTS; attempt += 1) {
      try {
        // Reuse the exact sealed envelope on every attempt. The RPC recognizes
        // that envelope at generation + 1, so a committed response lost in
        // transit is distinguishable from a concurrent OAuth reconnect.
        const committed = await input.store.commitCredentialRefresh({
          connectionId: input.connection.id,
          workerId: input.workerId,
          expectedGeneration: claim.generation,
          credential: rotated,
        });
        if (
          committed.outcome === "lease_lost" ||
          committed.outcome === "superseded"
        ) {
          ownsLease = false;
          throw new CalendarCredentialRefreshUnavailableError(
            committed.outcome,
          );
        }
        if (committed.outcome !== "committed") {
          throw new Error(
            `calendar credential refresh commit returned ${committed.outcome}`,
          );
        }
        lastCommitError = undefined;
        break;
      } catch (error) {
        if (error instanceof CalendarCredentialRefreshUnavailableError) {
          throw error;
        }
        lastCommitError = error;
      }
    }
    if (lastCommitError !== undefined) {
      // Releasing the lease here would make the still-stored old refresh token
      // immediately reusable even though the provider may have invalidated it.
      // Let the short lease expire; a later attempt can safely observe either
      // the idempotently committed envelope or the still-current generation.
      ownsLease = false;
      throw lastCommitError;
    }
    ownsLease = false;
    return {
      accessToken: tokens.accessToken,
      provider: providerFor(input.connection.provider, fetcher),
    };
  } catch (error) {
    if (ownsLease) {
      const retried = await input.store.retryCredentialRefresh({
        connectionId: input.connection.id,
        workerId: input.workerId,
        expectedGeneration: claim.generation,
        // Only the refresh-token exchange can prove the long-lived grant was
        // rejected. A later calendar API 401, decryption/configuration error,
        // or ambiguous commit must never downgrade a fresh OAuth reconnect.
        requiresReauth:
          stage === "refresh" &&
          error instanceof CalendarProviderError &&
          error.kind === "reauth",
        errorCode: credentialErrorCode(error),
        errorDetail: credentialErrorDetail(error),
      });
      if (
        ![
          "released",
          "reauth_required",
          "lease_lost",
          "superseded",
          "cleanup_abandoned",
        ].includes(retried.outcome)
      ) {
        throw new Error(
          `calendar credential refresh retry returned ${retried.outcome}`,
        );
      }
    }
    throw error;
  }
}
