/**
 * The MMS media contract (#189): the ONE definition of what a picture message
 * can carry on this platform, shared by the API (which enforces it — the API
 * stays the source of truth) and every composer (web today; the Android/iOS
 * pickers mirror these values in their own languages).
 *
 * Scope: Telnyx accepts a broad media set for MMS — images, audio, video,
 * contact cards (vCard), calendar invites, PDF, and plain text. US/CA carriers
 * genuinely deliver the subset below; anything outside it is either rejected
 * by Telnyx or silently dropped/transcoded to garbage by carriers, so the
 * allow-list is deliberately the DELIVERABLE set, not the acceptable one.
 *
 * Size: carriers cap the whole MMS around 1 MB in practice (some accept more,
 * many do not), so each item is held to 1 MB — the same ceiling the code has
 * always enforced for images. Item count stays at 3 (SPEC §7).
 */

/** Media types an outbound MMS may declare — what carriers actually deliver. */
export const MMS_OUTBOUND_MEDIA_TYPES = [
  // Images (SVG stays excluded everywhere: active-document XSS surface).
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  // Audio (voice notes, call snippets).
  "audio/mpeg",
  "audio/mp4",
  "audio/amr",
  "audio/wav",
  "audio/ogg",
  "audio/3gpp",
  // Video (short clips; carriers transcode aggressively above ~1 MB).
  "video/mp4",
  "video/3gpp",
  "video/quicktime",
  // Documents / cards / text.
  "application/pdf",
  "text/vcard",
  "text/x-vcard",
  "text/calendar",
  "text/plain",
] as const;

export type MmsMediaType = (typeof MMS_OUTBOUND_MEDIA_TYPES)[number];

/** Per-item decoded ceiling — the ~1 MB practical carrier limit (SPEC §7). */
export const MMS_MAX_MEDIA_BYTES = 1024 * 1024;

/** Per-message item cap (SPEC §7). */
export const MMS_MAX_MEDIA_ITEMS = 3;

/**
 * Vendor/legacy MIME spellings normalized onto the canonical allow-list —
 * carriers and OSes report these for files the platform can deliver fine.
 */
export const MMS_TYPE_ALIASES: Readonly<Record<string, MmsMediaType>> = {
  "audio/x-m4a": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/vnd.wave": "audio/wav",
  "audio/amr-nb": "audio/amr",
  "audio/mp3": "audio/mpeg",
  "video/3gp": "video/3gpp",
  "text/directory": "text/vcard",
};

/**
 * Canonicalize a raw content-type: lowercase, parameters stripped
 * (`text/vcard;charset=utf-8` → `text/vcard`), vendor aliases mapped. Returns
 * the cleaned string whether or not it is allowed — pair with
 * {@link isMmsMediaType}.
 */
export function canonicalMmsType(raw: string): string {
  const cleaned = raw.split(";")[0]?.trim().toLowerCase() ?? "";
  // Own-property lookup only: `cleaned` is an untrusted content-type, and a
  // bare `MMS_TYPE_ALIASES[cleaned]` would resolve inherited keys like
  // "constructor"/"__proto__"/"toString" to prototype members (a function/
  // object), bypassing the `?? cleaned` fallback and returning a non-alias.
  return Object.hasOwn(MMS_TYPE_ALIASES, cleaned)
    ? MMS_TYPE_ALIASES[cleaned]
    : cleaned;
}

/** True when `contentType` (already canonicalized or not) is deliverable. */
export function isMmsMediaType(contentType: string): contentType is MmsMediaType {
  return (MMS_OUTBOUND_MEDIA_TYPES as readonly string[]).includes(
    canonicalMmsType(contentType),
  );
}

/**
 * Extension fallback for pickers: some OS/browser combos report an EMPTY
 * `File.type` for perfectly deliverable files (.amr and .vcf are the usual
 * offenders on Windows). Keyed by lowercase extension, no dot.
 */
const MMS_EXTENSION_TYPES: Readonly<Record<string, MmsMediaType>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  amr: "audio/amr",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  mp4: "video/mp4",
  "3gp": "video/3gpp",
  mov: "video/quicktime",
  pdf: "application/pdf",
  vcf: "text/vcard",
  ics: "text/calendar",
  txt: "text/plain",
};

/**
 * Resolve the MMS content-type a picked file should be SENT as: the declared
 * type when it is deliverable (after canonicalization), else the extension
 * fallback, else null (not something MMS can carry). The API re-validates and
 * byte-sniffs — this only exists so a valid pick never round-trips to fail.
 */
export function mmsMediaTypeForFile(file: {
  name?: string | null;
  type?: string | null;
}): MmsMediaType | null {
  const declared = canonicalMmsType(file.type ?? "");
  if ((MMS_OUTBOUND_MEDIA_TYPES as readonly string[]).includes(declared)) {
    return declared as MmsMediaType;
  }
  const extension = (file.name ?? "").split(".").pop()?.toLowerCase() ?? "";
  return MMS_EXTENSION_TYPES[extension] ?? null;
}

/** Coarse kind for icons/labels — drives the file-chip rendering. */
export type MmsMediaKind =
  | "image"
  | "audio"
  | "video"
  | "contact"
  | "calendar"
  | "document"
  | "text"
  | "file";

/** Map a content-type onto its coarse kind (unknown/absent → "file"). */
export function mmsMediaKind(contentType: string | null | undefined): MmsMediaKind {
  const type = canonicalMmsType(contentType ?? "");
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  if (type === "text/vcard" || type === "text/x-vcard") return "contact";
  if (type === "text/calendar") return "calendar";
  if (type === "application/pdf") return "document";
  if (type.startsWith("text/")) return "text";
  return "file";
}
