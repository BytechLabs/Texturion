import { cn } from "@/lib/utils";

/**
 * #732: every page's header. The title on the left; the page's one main action
 * on the far right, always a filled button with an icon and a verb (New text,
 * New task, New contact, Dial); quieter actions and view switchers between
 * them. The same place and the same look on every page, so somebody who has
 * found "New" once knows where it is everywhere.
 */
export function PageHeader({
  title,
  description,
  status,
  secondary,
  primary,
  className,
}: {
  title: string;
  /** One line under the title saying what the page is for, or how things stand. */
  description?: React.ReactNode;
  /** A small status beside the title, such as whether the phone can ring. */
  status?: React.ReactNode;
  /** Outline or ghost controls: Scheduled, Export, Import, a view switcher. */
  secondary?: React.ReactNode;
  /** The one main action. Pass a default (filled) Button. */
  primary?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", className)}>
      <div className="mr-auto min-w-0">
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-app-ink">
            {title}
          </h1>
          {status}
        </div>
        {description && <p className="mt-1 text-sm text-app-muted">{description}</p>}
      </div>
      {secondary && <div className="flex flex-wrap items-center gap-2">{secondary}</div>}
      {primary}
    </header>
  );
}
