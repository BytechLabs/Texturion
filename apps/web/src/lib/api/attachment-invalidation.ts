import type { QueryClient } from "@tanstack/react-query";

import { keys } from "./keys";

/**
 * The read surfaces a new note file touches, invalidated as one set so both
 * upload paths (`useUploadAttachment`, `useUploadNoteFiles`) stay in lockstep:
 *   1. the note's own attachment list (the bubble's Files section);
 *   2. the tasks root — a task-linked note's files feed the D28 derived task
 *      union (drawer list + checklist attachment_count);
 *   3. the conversation attachments gallery root (§5.2) — a note file is one
 *      of its three union arms, so an in-session gallery would otherwise miss
 *      the new row until a delete happened to refresh it. The root
 *      (`[companyId, "conversations", "attachments"]`, no conversation id) is
 *      the prefix `useDeleteAttachment` also invalidates.
 *
 * A PURE helper deliberately kept OUT of attachments.ts: that module's hooks
 * pull the whole app-data + UI graph (client → env, company/provider →
 * ui/button, …), so co-locating this forced its unit test to `await
 * import("./attachments")` and evaluate that entire graph — which intermittently
 * blew the 5s test timeout under parallel load. Living here, it imports only
 * `keys`, so the test imports it statically (fast, deterministic).
 */
export function invalidateAfterNoteUpload(
  queryClient: QueryClient,
  companyId: string,
  noteId: string,
) {
  void queryClient.invalidateQueries({
    queryKey: keys.ownerAttachments(companyId, "note", noteId),
  });
  void queryClient.invalidateQueries({ queryKey: [companyId, "tasks"] });
  void queryClient.invalidateQueries({
    queryKey: [companyId, "conversations", "attachments"],
  });
}
