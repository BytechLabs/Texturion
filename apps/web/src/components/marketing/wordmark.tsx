import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The Loonext marketing wordmark: the petrol loon tile (favicon-consistent),
 * followed by the "Loonext" wordmark in Inter 600 with the petrol accent on
 * "ext". Links to the marketing home by default (the app shell's Wordmark
 * defaults to /inbox, this one is for chrome).
 */
export function Wordmark({
  href = "/",
  className,
  showMark = true,
}: {
  href?: string;
  className?: string;
  showMark?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label="Loonext home"
      className={cn(
        "inline-flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground",
        className,
      )}
    >
      {showMark && <LoonMark className="size-7" />}
      <span className="leading-none">
        Loon<span className="text-primary">ext</span>
      </span>
    </Link>
  );
}

/**
 * The petrol tile with the Loonext loon in profile — head, curved neck, and the
 * loon's straight dagger bill as a white silhouette with a petrol eye. Kept in
 * exact sync with public/icons/loonext-icon.svg (the favicon source of truth).
 */
export function LoonMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="512" height="512" rx="116" ry="116" fill="#0F766E" />
      <path
        fill="#FFFFFF"
        d="M 196 396 C 178 330 186 256 236 222 C 228 178 262 150 302 152 C 330 154 346 168 348 180 L 436 170 L 350 202 C 352 216 346 246 324 264 C 302 308 298 352 302 396 Z"
      />
      <circle cx="300" cy="198" r="15" fill="#0F766E" />
    </svg>
  );
}
