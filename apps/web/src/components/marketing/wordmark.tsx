import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The Loonext marketing wordmark (BLUEPRINT §10.3): a rounded speech-bubble tile
 * in petrol containing a white "J", followed by the "Loonext" wordmark in Inter
 * 600 with the petrol accent on "Text". Links to the marketing home by default
 * (the app shell's Wordmark defaults to /inbox, this one is for chrome).
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
      {showMark && <BubbleMark className="size-7" />}
      <span className="leading-none">
        Job<span className="text-primary">Text</span>
      </span>
    </Link>
  );
}

/** The petrol speech-bubble tile with a white J (favicon-consistent). */
export function BubbleMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="512" height="512" rx="116" ry="116" fill="#0F766E" />
      <g fill="none" stroke="#FFFFFF" strokeLinecap="round">
        <g transform="translate(256 256) scale(1.25) translate(-158 -258)">
          <path d="M 214 154 V 304 A 58 58 0 0 1 102 324" strokeWidth="54" />
        </g>
      </g>
    </svg>
  );
}
