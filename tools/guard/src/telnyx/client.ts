/**
 * The guard's own Telnyx calls. There is no base-URL override: a variable
 * that could move this host could hand the key to anybody who set it.
 */
export const TELNYX_ORIGIN = "https://api.telnyx.com";

export interface TelnyxReply {
  status: number;
  /** The parsed body, or undefined when it was empty or not JSON. */
  body: unknown;
  text: string;
}

export class TelnyxError extends Error {
  readonly status: number;

  constructor(method: string, path: string, status: number) {
    super(`Telnyx ${method} ${path.split("?")[0]} answered ${status}`);
    this.name = "TelnyxError";
    this.status = status;
  }
}

export interface TelnyxApi {
  /** One request; never throws for an HTTP status. */
  send(
    method: string,
    pathAndQuery: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<TelnyxReply>;
  /** A 2xx body, or a {@link TelnyxError}. */
  call<T>(method: string, pathAndQuery: string, body?: unknown): Promise<T>;
  /** Every item of a paged list, up to `maxPages` pages of 250. */
  listAll<T>(path: string, query?: Record<string, string>, maxPages?: number): Promise<T[]>;
}

export function telnyxApi(key: string, fetcher: typeof fetch): TelnyxApi {
  async function send(
    method: string,
    pathAndQuery: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<TelnyxReply> {
    const response = await fetcher(`${TELNYX_ORIGIN}${pathAndQuery}`, {
      method,
      headers: {
        ...headers,
        authorization: `Bearer ${key}`,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    return { status: response.status, body: parsed, text };
  }

  async function call<T>(method: string, pathAndQuery: string, body?: unknown): Promise<T> {
    const reply = await send(method, pathAndQuery, body);
    if (reply.status < 200 || reply.status > 299) {
      throw new TelnyxError(method, pathAndQuery, reply.status);
    }
    return reply.body as T;
  }

  async function listAll<T>(
    path: string,
    query: Record<string, string> = {},
    maxPages = 20,
  ): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const params = new URLSearchParams({ ...query, "page[size]": "250", "page[number]": String(page) });
      const reply = await call<{ data?: T[]; meta?: { total_pages?: number } }>(
        "GET",
        `${path}?${params.toString()}`,
      );
      items.push(...(reply?.data ?? []));
      const totalPages = reply?.meta?.total_pages ?? 1;
      if (page >= totalPages) return items;
    }
    // A listing longer than the cap is answered as a failure, because every
    // caller of this reads "absent from the list" as a fact.
    throw new Error(`Telnyx ${path} has more than ${maxPages} pages`);
  }

  return { send, call, listAll };
}
