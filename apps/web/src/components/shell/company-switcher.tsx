"use client";

import { Check, ChevronDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveCompany } from "@/lib/company/provider";
import { cn } from "@/lib/utils";

/** First letter of the active company, for the tinted chip dot (mockup .co-dot). */
function companyLetter(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

/**
 * The top-bar company chip (APP-SHELL-REDESIGN §3, mockup .company): a compact
 * white pill with a tinted initial dot and the active workspace name. Multi-
 * company users get a dropdown to switch; single-company users see a static chip
 * (G12 — no switcher when there is nothing to switch to). Company switch
 * behavior is preserved from the old sidebar UserMenu.
 */
export function CompanySwitcher() {
  const { membership, memberships, switchCompany } = useActiveCompany();
  const multi = memberships.length > 1;

  const chip = (
    <>
      <span
        aria-hidden
        className="grid size-[22px] place-items-center rounded-full bg-app-tint text-[11px] font-bold text-app-petrol-deep"
      >
        {companyLetter(membership.name)}
      </span>
      <span className="max-w-[10rem] truncate">{membership.name}</span>
      {multi && (
        <ChevronDown
          className="size-[15px] shrink-0 text-app-muted-2"
          strokeWidth={2}
          aria-hidden
        />
      )}
    </>
  );

  const chipClasses = cn(
    "inline-flex h-[34px] items-center gap-2 rounded-full border border-app-line bg-app-white pl-2 pr-2.5 text-[13px] font-medium text-app-ink shadow-[0_1px_1px_rgba(20,32,30,0.03)] transition-[border-color,box-shadow] duration-150 ease-out",
  );

  if (!multi) {
    return (
      <div className={chipClasses} aria-label={`Workspace: ${membership.name}`}>
        {chip}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Switch company"
        className={cn(
          chipClasses,
          "cursor-pointer outline-none hover:border-app-tint-line hover:app-shadow-row focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {chip}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {memberships.map((m) => (
          <DropdownMenuItem
            key={m.company_id}
            onSelect={() => switchCompany(m.company_id)}
          >
            <span className="min-w-0 flex-1 truncate">{m.name}</span>
            {m.company_id === membership.company_id && (
              <Check className="size-4 text-primary" strokeWidth={1.75} />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
