import { golosText } from "@/lib/app/fonts";
import { cn } from "@/lib/utils";

/**
 * <AppSurface>: the type layer of every product embed on the marketing site
 * (Law 2: marketing frames the product, it never repaints it). PanelFrame's
 * `.app-scope` wrapper re-pins the app's own COLOR tokens (petrol primary,
 * the app bubbles, the unread dot), but the app's own FACE (Golos Text,
 * mounted by the (app) layout as --font-golos) does not exist on marketing
 * routes unless something mounts it. This wrapper mounts the variable and
 * applies `font-sans` (which the .app-scope block repoints to Golos), so a
 * product embed reads in the product's real face, not the marketing trio.
 *
 * Use it as the direct child of a PanelFrame / any `.app-scope` region:
 *   <PanelFrame>
 *     <AppSurface>…real product patterns…</AppSurface>
 *   </PanelFrame>
 */
export function AppSurface({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        golosText.variable,
        "font-sans bg-background text-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}
