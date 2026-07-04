import type { SearchResult } from "./types";

/**
 * Coalesce a /v1/search response into the full five-arm shape. Web and API
 * deploy independently (and a Worker can be rolled back), so the palette can
 * meet a v1-shaped payload that predates the D29 arms (tasks / attachments /
 * templates). Missing arms become `[]` so every reader (`search.data.tasks
 * .length`) stays safe instead of throwing a TypeError that unmounts the shell.
 *
 * Kept in its own pure, dependency-free module (only the `SearchResult` TYPE)
 * so it unit-tests without the env-validated API client — the same idiom as
 * lib/attachments/validate.ts.
 */
export function normalizeSearch(result: SearchResult): SearchResult {
  return {
    conversations: result.conversations ?? [],
    contacts: result.contacts ?? [],
    tasks: result.tasks ?? [],
    attachments: result.attachments ?? [],
    templates: result.templates ?? [],
    next_cursor: result.next_cursor ?? null,
  };
}
