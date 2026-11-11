/**
 * #744 — does the subscription link we just created actually answer?
 *
 * The link was once built on the wrong host and every one returned "page not
 * found", which nobody noticed until a customer pasted it. The page now asks
 * the link itself, right after creating it, so that failure shows up in the
 * product.
 */
export type FeedLinkCheck =
  | { state: "working" }
  /** The host answered, but not with a calendar. `status` is the HTTP status. */
  | { state: "error"; status: number }
  /** No answer at all: offline, blocked, or the host is down. */
  | { state: "unreachable" };

export async function checkFeedLink(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FeedLinkCheck> {
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
    });
    if (!res.ok) return { state: "error", status: res.status };
    const body = await res.text();
    // A 200 that is a web page is as broken as a 404 for a calendar app.
    return body.startsWith("BEGIN:VCALENDAR")
      ? { state: "working" }
      : { state: "error", status: res.status };
  } catch {
    return { state: "unreachable" };
  }
}
