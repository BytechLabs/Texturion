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

/** Every catalogue key this module names. */
export type MmsRejectionKey =
  | "thread.thatFile"
  | "thread.attachLimitText"
  | "thread.mmsUnsupportedFile"
  | "thread.mmsFileEmpty"
  | "thread.mmsFileTooBig";

/** The reader's resolver. */
export type SayMmsRejection = (
  key: MmsRejectionKey,
  vars?: Record<string, string>,
) => string;

/*
 * The name is INTERPOLATED rather than glued to the front of the sentence.
 * Both phone catalogues carry that note against the same keys: the subject is
 * not where every language starts, and a French sentence built by
 * concatenation puts it in the wrong place.
 */
function displayName(file: FileLike, say: SayMmsRejection): string {
  const name = file.name?.trim();
  return name ? `"${name}"` : say("thread.thatFile");
}

/**
 * Validate one candidate against the MMS limits. `currentCount` is how many
 * items the draft already holds (staged + this batch's admissions).
 */
export function validateMmsFile<T extends FileLike>(
  file: T,
  currentCount: number,
  say: SayMmsRejection,
):
  | { ok: true; contentType: MmsMediaType }
  | { ok: false; reason: string } {
  if (currentCount >= MMS_MAX_MEDIA_ITEMS) {
    return {
      ok: false,
      reason: say("thread.attachLimitText", {
        max: String(MMS_MAX_MEDIA_ITEMS),
      }),
    };
  }
  const contentType = mmsMediaTypeForFile({
    name: file.name ?? null,
    type: file.type ?? null,
  });
  if (contentType === null) {
    return {
      ok: false,
      reason: say("thread.mmsUnsupportedFile", {
        name: displayName(file, say),
      }),
    };
  }
  if (file.size === 0) {
    return {
      ok: false,
      reason: say("thread.mmsFileEmpty", { name: displayName(file, say) }),
    };
  }
  if (file.size > MMS_MAX_MEDIA_BYTES) {
    return {
      ok: false,
      reason: say("thread.mmsFileTooBig", { name: displayName(file, say) }),
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
  currentCount: number,
  say: SayMmsRejection,
): { accepted: AdmittedMmsFile<T>[]; rejected: RejectedMmsFile<T>[] } {
  const accepted: AdmittedMmsFile<T>[] = [];
  const rejected: RejectedMmsFile<T>[] = [];
  for (const file of incoming) {
    const check = validateMmsFile(file, currentCount + accepted.length, say);
    if (check.ok) accepted.push({ file, contentType: check.contentType });
    else rejected.push({ file, reason: check.reason });
  }
  return { accepted, rejected };
}
