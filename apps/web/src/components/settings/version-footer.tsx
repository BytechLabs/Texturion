import { golosText } from "@/lib/app/fonts";
import { cn } from "@/lib/utils";

/**
 * The shipped version, at the foot of Settings.
 *
 * A crew reporting a problem, and whoever answers them, both need to know what
 * they are actually running — Android has said so in its settings footer for a
 * while and the web said nothing at all. The string comes from the build
 * (NEXT_PUBLIC_APP_VERSION, injected in next.config from package.json, which
 * release-please bumps), so it cannot drift from what shipped.
 *
 * The wordmark rule holds (brand/README.md): "Loonext" in Golos with the SECOND
 * o in the accent, as text spans, never an image.
 */
export function VersionFooter({ className }: { className?: string }) {
  const version = process.env.NEXT_PUBLIC_APP_VERSION;
  if (!version) return null;
  return (
    <p
      className={cn(
        golosText.variable,
        "select-text text-[11px] text-app-muted-2 [font-family:var(--font-golos),system-ui,sans-serif]",
        className,
      )}
    >
      Lo<span className="text-[#66801F] dark:text-[#B9CF57]">o</span>next{" "}
      <span className="tabular-nums">{version}</span>
    </p>
  );
}
