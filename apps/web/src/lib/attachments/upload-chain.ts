/**
 * The staged-note-upload sequencer (D28). Pure and dependency-free (like
 * validate.ts) so the chain unit-tests without React, the env-validated API
 * client, or the network — the hook layer (`useUploadNoteFiles` in
 * lib/api/attachments.ts) injects the real single-file uploader.
 */

/** The outcome of a staged multi-file upload chain (composer note saves). */
export interface StagedUploadResult {
  uploaded: number;
  /** Files that didn't make it, each with the plain API sentence. */
  failed: { name: string; message: string }[];
}

/**
 * Upload staged files one at a time through an injected single-file uploader,
 * collecting failures instead of throwing — a partial failure must never lose
 * the files that DID land (D28: the note bubble's Files section is the retry
 * surface). Sequential on purpose: the API's per-owner cap counts live rows
 * per request, so parallel uploads could race past 10.
 */
export async function uploadFilesSequentially(
  uploadOne: (file: File) => Promise<unknown>,
  files: readonly File[],
): Promise<StagedUploadResult> {
  const failed: StagedUploadResult["failed"] = [];
  let uploaded = 0;
  for (const file of files) {
    try {
      await uploadOne(file);
      uploaded += 1;
    } catch (error) {
      failed.push({
        name: file.name || "file",
        message:
          error instanceof Error
            ? error.message
            : "That file didn't upload. Try again.",
      });
    }
  }
  return { uploaded, failed };
}
