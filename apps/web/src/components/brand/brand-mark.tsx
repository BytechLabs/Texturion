/**
 * The Loonext brand, as code (#206). Source of truth: brand/README.md.
 *
 * The mark is the "oo" of Loonext: two thick rings, the second one colored.
 * Light contexts: ink #191B14 + olive #66801F; dark contexts: paper #F0F1E5
 * + lime #B9CF57. These are IDENTITY colors, deliberately not app UI tokens
 * (the app's petrol accent is a design-system color, not the brand).
 *
 * The wordmark rule lives next to it: "Loonext" in Golos Text SemiBold with
 * the SECOND o in the accent — always rendered as text spans (see
 * components/shell/wordmark.tsx and the marketing nav/footer), never as an
 * image, so it scales and themes.
 */

/** Brand identity palette (brand/README.md). */
export const BRAND = {
  ink: "#191B14",
  olive: "#66801F",
  paper: "#F0F1E5",
  lime: "#B9CF57",
  tile: "#FDFDF9",
  hairline: "#E8E8E0",
  coral: "#D96C47",
} as const;

/**
 * The bare double-o mark (brand/loonext-mark.svg geometry: r=86, stroke=52,
 * 16px gap). Theme-aware: ink + olive rings in light, paper + lime in dark
 * (class-strategy `dark:` — app-wide or a local marketing `.dark` region).
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="136"
        cy="256"
        r="86"
        fill="none"
        strokeWidth="52"
        className="stroke-[#191B14] dark:stroke-[#F0F1E5]"
      />
      <circle
        cx="376"
        cy="256"
        r="86"
        fill="none"
        strokeWidth="52"
        className="stroke-[#66801F] dark:stroke-[#B9CF57]"
      />
    </svg>
  );
}

/**
 * The app tile (brand/loonext-tile.svg): the mark on the paper tile with the
 * hairline border. For depicting the app's OWN icon — push-notification
 * banner marks inside phone frames, app-icon call-outs. Fixed colors on
 * purpose: the installed launcher icon looks the same in both themes.
 */
export function BrandTile({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="2"
        y="2"
        width="508"
        height="508"
        rx="114"
        ry="114"
        fill={BRAND.tile}
        stroke={BRAND.hairline}
        strokeWidth="4"
      />
      <circle
        cx="172"
        cy="256"
        r="60"
        fill="none"
        stroke={BRAND.ink}
        strokeWidth="36"
      />
      <circle
        cx="340"
        cy="256"
        r="60"
        fill="none"
        stroke={BRAND.olive}
        strokeWidth="36"
      />
    </svg>
  );
}
