/**
 * Search-only URL changes (filters, tabs, the `?task=` drawer, a dialog param)
 * written with the History API instead of a router navigation, so the click
 * changes the UI at once and sends no request to the web Worker.
 *
 * Next 16 patches `history.pushState` and `history.replaceState` so that
 * `usePathname` and `useSearchParams` follow the new URL, and copies its own
 * tree into the entry so Back and Forward still restore through the router.
 * That patch is installed in an effect of the App Router, and child effects run
 * before parent ones: call these only from event handlers or from effects that
 * run after mount. A write made earlier is invisible to `useSearchParams` and
 * leaves an entry the router cannot restore.
 *
 * The URL is built from `window.location`, never from a `searchParams` captured
 * at render, so two quick toggles do not drop each other's params.
 */

type SearchInput = URLSearchParams | string;
type HistoryMode = "replace" | "push";

function urlWithSearch(next: SearchInput): string {
  const query = (typeof next === "string" ? next : next.toString()).replace(
    /^\?/,
    "",
  );
  const { pathname, hash } = window.location;
  return `${pathname}${query ? `?${query}` : ""}${hash}`;
}

function writeSearch(next: SearchInput, mode: HistoryMode): void {
  const url = urlWithSearch(next);
  const { pathname, search, hash } = window.location;
  // Same as router.push: an unchanged URL adds no history entry.
  if (url === `${pathname}${search}${hash}`) return;
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

/** Replace the current entry's search string; the path and hash stay. */
export function replaceSearch(next: SearchInput): void {
  writeSearch(next, "replace");
}

/** Push a new entry with this search string, so Back returns to the old one. */
export function pushSearch(next: SearchInput): void {
  writeSearch(next, "push");
}

/** Edit the live search params in place, then replace or push the result. */
export function updateSearch(
  mutate: (params: URLSearchParams) => void,
  mode: HistoryMode = "replace",
): void {
  const params = new URLSearchParams(window.location.search);
  mutate(params);
  writeSearch(params, mode);
}
