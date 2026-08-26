import {
  CalendarEventNotFoundError,
  CalendarFullResyncRequiredError,
  type CalendarFetch,
  type CalendarProviderName,
  CalendarPreconditionError,
  CalendarProviderError,
  CalendarReauthRequiredError,
  CalendarRetryableError,
} from "./types";

interface ProviderRequestOptions {
  provider: CalendarProviderName;
  operation: string;
  fullResyncOnGone?: boolean;
}

/** A provider outage must fail a lease truthfully instead of hanging it. */
export function calendarProviderSignal(
  existing: AbortSignal | null | undefined,
  timeoutMs = 10_000,
): AbortSignal {
  const deadline = AbortSignal.timeout(timeoutMs);
  return existing ? AbortSignal.any([existing, deadline]) : deadline;
}

function retryAfterMilliseconds(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000);
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

async function errorDetail(response: Response): Promise<string> {
  try {
    return (await response.text()).replace(/\s+/g, " ").slice(0, 512);
  } catch {
    return "";
  }
}

export async function providerRequest(
  fetcher: CalendarFetch,
  url: string,
  init: RequestInit,
  options: ProviderRequestOptions,
): Promise<Response> {
  const response = await fetcher(url, {
    ...init,
    signal: calendarProviderSignal(init.signal),
  });
  if (response.ok) return response;

  if (response.status === 401) {
    throw new CalendarReauthRequiredError(
      options.provider,
      options.operation,
    );
  }
  if (response.status === 429) {
    throw new CalendarRetryableError(
      options.provider,
      options.operation,
      response.status,
      retryAfterMilliseconds(response.headers.get("Retry-After")),
    );
  }
  if (response.status === 409 || response.status === 412) {
    throw new CalendarPreconditionError(
      options.provider,
      options.operation,
      response.status,
    );
  }
  if (response.status === 410 && options.fullResyncOnGone) {
    throw new CalendarFullResyncRequiredError(
      options.provider,
      options.operation,
    );
  }
  if (response.status === 404 || response.status === 410) {
    throw new CalendarEventNotFoundError(
      options.provider,
      options.operation,
      response.status,
    );
  }

  const detail = await errorDetail(response);
  throw new CalendarProviderError(
    `${options.provider} calendar ${options.operation} failed (${response.status})${detail ? `: ${detail}` : ""}`,
    options.provider,
    "response",
    options.operation,
    response.status,
  );
}

export async function providerJson<T>(
  fetcher: CalendarFetch,
  url: string,
  init: RequestInit,
  options: ProviderRequestOptions,
): Promise<T> {
  const response = await providerRequest(fetcher, url, init, options);
  return (await response.json()) as T;
}

export async function providerVoid(
  fetcher: CalendarFetch,
  url: string,
  init: RequestInit,
  options: ProviderRequestOptions,
): Promise<void> {
  await providerRequest(fetcher, url, init, options);
}
