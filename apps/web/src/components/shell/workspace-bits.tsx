"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { formatPhone } from "@/lib/format/phone";

/** The company tile's square logo initials (e.g. "Rivera Plumbing" → "RP"). */
export function companyInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * One active business number + a copy button. The number itself is the useful
 * thing (not "1 number active"); copy writes the raw E.164 and flips to a check
 * for a beat. A standalone row so it never nests a button inside a button (the
 * workspace tiles are themselves buttons). Shared by the desktop sidebar's
 * number strip and the mobile header so both render numbers identically and
 * handle more than one number the same way.
 */
export function CopyableNumberRow({ e164 }: { e164: string }) {
  const [copied, setCopied] = useState(false);
  const label = formatPhone(e164);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(e164);
      setCopied(true);
      toast.success("Number copied.");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy. Your browser blocked clipboard access.");
    }
  };
  return (
    <div className="flex items-center gap-1.5 text-[12px]">
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full bg-app-petrol"
      />
      <span className="min-w-0 flex-1 truncate tabular-nums text-app-ink">
        {label}
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy ${label}`}
        className="grid size-6 shrink-0 place-items-center rounded-[6px] text-app-muted-2 outline-none transition-colors duration-150 ease-out hover:bg-app-line-soft hover:text-app-ink focus-visible:ring-2 focus-visible:ring-ring"
      >
        {copied ? (
          <Check className="size-3.5" strokeWidth={2} aria-hidden />
        ) : (
          <Copy className="size-3.5" strokeWidth={1.75} aria-hidden />
        )}
      </button>
    </div>
  );
}
