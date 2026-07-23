/**
 * Client-side MMS media validation (#189) — the pre-flight gate for the text
 * composers (in-thread and /inbox/new), so a pick that would 422 never
 * round-trips. Mirrors the API's outbound gate exactly: the deliverable
 * allow-list, the 1 MB per-item ceiling, and the 3-item cap all come from
 * @loonext/shared (the one contract both sides read); the API re-validates
 * and byte-sniffs, so this is a courtesy check, never the only one.
 *
 * Pure and dependency-free so it unit-tests without React or the network.
 */
import {
  MMS_MAX_MEDIA_BYTES,
  MMS_MAX_MEDIA_ITEMS,
  MMS_OUTBOUND_MEDIA_TYPES,
  mmsMediaTypeForFile,
  type MmsMediaType,
} from "@loonext/shared";

export { MMS_MAX_MEDIA_BYTES, MMS_MAX_MEDIA_ITEMS };
export type { MmsMediaType };

/**
 * The `accept` attribute for the composers' hidden <input type="file">. Not a
 * security control (the API is) — it steers the OS picker toward the
 * deliverable set. Extensions ride along for the files whose MIME type the OS
 * reports empty (.vcf and .amr are the usual offenders on Windows).
 */
export const MMS_ACCEPT = [
  ...MMS_OUTBOUND_MEDIA_TYPES,
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".mp3",
  ".m4a",
  ".amr",
  ".wav",
  ".ogg",
  ".mp4",
  ".3gp",
  ".mov",
  ".pdf",
  ".vcf",
  ".ics",
  ".txt",
].join(",");

/** One admitted file with the content type it will be SENT as. */
export interface AdmittedMmsFile<T> {
  file: T;
  contentType: MmsMediaType;
}

/** One rejected file with its plain-language reason (G10 copy, no codes). */
export interface RejectedMmsFile<T> {
  file: T;
  reason: string;
}

/** A minimal File shape so the logic tests without the DOM. */
interface FileLike {
  name?: string | null;
  type?: string | null;
  size: number;
}

function displayName(file: FileLike): string {
  const name = file.name?.trim();
  return name ? `"${name}"` : "That file";
}

/**
 * Validate one candidate against the MMS limits. `currentCount` is how many
 * items the draft already holds (staged + this batch's admissions).
 */
export function validateMmsFile<T extends FileLike>(
  file: T,
  currentCount = 0,
):
  | { ok: true; contentType: MmsMediaType }
  | { ok: false; reason: string } {
  if (currentCount >= MMS_MAX_MEDIA_ITEMS) {
    return {
      ok: false,
      reason: `You can attach up to ${MMS_MAX_MEDIA_ITEMS} files per text.`,
    };
  }
  const contentType = mmsMediaTypeForFile({
    name: file.name ?? null,
    type: file.type ?? null,
  });
  if (contentType === null) {
    return {
      ok: false,
      reason: `${displayName(file)} isn't something a text can carry. Try a photo, video, audio clip, contact card, or PDF.`,
    };
  }
  if (file.size === 0) {
    return { ok: false, reason: `${displayName(file)} is empty.` };
  }
  if (file.size > MMS_MAX_MEDIA_BYTES) {
    return {
      ok: false,
      reason: `${displayName(file)} is over 1 MB, the most a text can carry.`,
    };
  }
  return { ok: true, contentType };
}

/**
 * Validate a batch (picker multi-select, drop, paste) against the MMS limits,
 * counting each admission toward the 3-item cap as it goes — dropping 5 files
 * onto an empty draft admits the first 3 and rejects the rest with the cap
 * sentence. Pure; callers stage `accepted` and surface `rejected[].reason`
 * inline.
 */
export function partitionMmsFiles<T extends FileLike>(
  incoming: readonly T[],
  currentCount = 0,
): { accepted: AdmittedMmsFile<T>[]; rejected: RejectedMmsFile<T>[] } {
  const accepted: AdmittedMmsFile<T>[] = [];
  const rejected: RejectedMmsFile<T>[] = [];
  for (const file of incoming) {
    const check = validateMmsFile(file, currentCount + accepted.length);
    if (check.ok) accepted.push({ file, contentType: check.contentType });
    else rejected.push({ file, reason: check.reason });
  }
  return { accepted, rejected };
}
