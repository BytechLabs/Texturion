"use client";

import type { UsageStorage } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/** Compact byte size ("967 KB", "1.1 MB"). */
export function formatStorageBytes(bytes: number): string {
  if (bytes <= 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1);
  return `${rounded} ${units[unit]}`;
}

export interface StorageSlice {
  key: string;
  label: string;
  bytes: number;
  /** Tailwind background for the bar segment and its legend dot. */
  className: string;
}

/**
 * What the workspace is storing, as a composition of every kind of file we
 * hold, each named for what it actually is:
 *
 *   - attachments received     (media a customer sent — NOT "picture messages":
 *                              since #189 an MMS can be audio, video, a PDF, or
 *                              a contact card, and the founder's own voice
 *                              message proved the old wording wrong)
 *   - attachments sent         (media we sent out, previously folded in with
 *                              received so neither could be seen)
 *   - files on notes           (generic attachments a crew uploads)
 *   - voicemail recordings     (we download every voicemail into our bucket and
 *                              delete the Telnyx copy, so it is ours to hold —
 *                              and it was missing from this page entirely)
 *   - other files              (shown only when real: whatever the physical
 *                              bucket total exceeds the named kinds by, so the
 *                              breakdown can never quietly under-report)
 *
 * This is deliberately NOT a meter. Storage is free and capless (#121/D34), so
 * the bar has no maximum, no remaining, and no warning colour: it fills its
 * width always and only shows PROPORTION between the kinds. That keeps #178's
 * rule — usage is never a wall — while answering "what is actually in there".
 */
export function StorageBreakdown({ storage }: { storage: UsageStorage }) {
  const slices: StorageSlice[] = [
    {
      key: "received",
      label: "Attachments received",
      bytes: storage.received_media_bytes,
      className: "bg-app-petrol",
    },
    {
      key: "sent",
      label: "Attachments sent",
      bytes: storage.sent_media_bytes,
      // Deep petrol pairs this with "received" above: both are message
      // attachments, told apart by direction. It replaces an olive that the
      // palette never defined, so Tailwind emitted no rule at all and this
      // slice was invisible in both the bar and its legend swatch.
      className: "bg-app-petrol-deep",
    },
    {
      key: "notes",
      label: "Files on notes",
      bytes: storage.attachments_bytes,
      className: "bg-app-amber",
    },
    {
      key: "voicemail",
      label: "Voicemail recordings",
      bytes: storage.voicemail_bytes,
      className: "bg-app-clay",
    },
    // Only ever shown when it is real: anything the named kinds miss.
    {
      key: "other",
      label: "Other files",
      bytes: storage.other_bytes,
      className: "bg-app-muted-2",
    },
  ];
  // The bucket-measured total is the truth; fall back to the parts if a Worker
  // predating the breakdown is still answering.
  const total =
    storage.total_bytes > 0
      ? storage.total_bytes
      : slices.reduce((sum, slice) => sum + Math.max(slice.bytes, 0), 0);

  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing stored yet. Attachments in and out, files on notes, and
        voicemail recordings are all free on every plan, with no caps.
      </p>
    );
  }

  const present = slices.filter((slice) => slice.bytes > 0);
  // "Other files" is noise when it is zero, but every named kind stays listed
  // so the legend reads as a complete inventory rather than a shifting set.
  const listed = slices.filter(
    (slice) => slice.key !== "other" || slice.bytes > 0,
  );

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-foreground">
          {formatStorageBytes(total)} stored
        </span>
        <span className="text-xs text-muted-foreground">
          Free on every plan, no caps
        </span>
      </div>

      {/* One full-width bar split by proportion. No track showing "remaining",
          because there is no limit to remain under. */}
      <div
        className="mt-2 flex h-2 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={`Storage: ${present
          .map((slice) => `${formatStorageBytes(slice.bytes)} ${slice.label.toLowerCase()}`)
          .join(", ")}. Free on every plan, no caps.`}
      >
        {present.map((slice) => (
          <span
            key={slice.key}
            className={cn("h-full", slice.className)}
            style={{ width: `${(slice.bytes / total) * 100}%` }}
          />
        ))}
      </div>

      <ul className="mt-3 space-y-1.5" aria-hidden>
        {listed.map((slice) => (
          <li
            key={slice.key}
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                slice.bytes > 0 ? slice.className : "bg-app-line",
              )}
            />
            <span className="flex-1">{slice.label}</span>
            <span className="tabular-nums">
              {formatStorageBytes(slice.bytes)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
