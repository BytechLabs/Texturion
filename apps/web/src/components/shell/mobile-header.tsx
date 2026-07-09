"use client";

import { Check, ChevronsUpDown } from "lucide-react";

import { NotificationBell } from "@/components/notifications/notification-bell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNumbers } from "@/lib/api/numbers";
import { useActiveCompany } from "@/lib/company/provider";

import { avatarInitials } from "./avatar-color";
import { MemberMenu } from "./member-menu";
import { WorkspaceNumbers, companyInitials } from "./workspace-bits";

/**
 * Mobile top header (<1000px). The desktop sidebar — which carries the
 * workspace tile + switcher, the copyable business number(s), and the account
 * menu (Settings · theme · Sign out) — is hidden below lg, where only the
 * bottom tab bar remains. Below lg those affordances had NO home (the number
 * was invisible and "Sign out" was buried under More → Settings → Account), so
 * this header restores them: workspace name (+ switcher when multi-workspace)
 * on the left, notifications + the account avatar (opening the member menu) on
 * the right, and the copyable number strip beneath. Hidden at lg+, where the
 * sidebar owns all of this.
 */
export function MobileHeader() {
  const { membership, memberships, switchCompany, displayName } =
    useActiveCompany();
  const numbers = useNumbers();

  const multi = memberships.length > 1;
  const numberRows = numbers.data?.data ?? [];

  const workspaceTile = (
    <span className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-app-tint text-[13px] font-semibold text-app-petrol-deep"
      >
        {companyInitials(membership.name)}
      </span>
      <span className="min-w-0 truncate text-left text-[14px] font-semibold text-app-ink">
        {membership.name}
      </span>
      {multi && (
        <ChevronsUpDown
          className="size-4 shrink-0 text-app-muted-2"
          strokeWidth={1.75}
          aria-hidden
        />
      )}
    </span>
  );

  return (
    <header className="shrink-0 border-b border-app-line bg-app-white lg:hidden">
      <div className="flex h-14 items-center justify-between gap-2 px-3">
        {multi ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Switch workspace"
              className="flex min-w-0 items-center rounded-[10px] px-1 py-1 outline-none transition-colors duration-150 ease-out hover:bg-app-line-soft focus-visible:ring-2 focus-visible:ring-ring"
            >
              {workspaceTile}
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
        ) : (
          <span
            className="flex min-w-0 items-center px-1"
            aria-label={`Workspace: ${membership.name}`}
          >
            {workspaceTile}
          </span>
        )}

        <span className="flex shrink-0 items-center gap-1">
          <NotificationBell appVariant />
          {/* The account menu opens DOWN from the header (the sidebar's opens
              up from the footer); it carries Settings, theme, and Sign out —
              so logout is one obvious tap on mobile. */}
          <MemberMenu side="bottom" align="end">
            <button
              type="button"
              aria-label="Account and settings"
              className="grid size-9 place-items-center rounded-full outline-none transition-colors duration-150 ease-out hover:bg-app-line-soft focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                aria-hidden
                className="grid size-7 place-items-center rounded-full bg-app-tint text-[11px] font-semibold text-app-petrol-deep"
              >
                {avatarInitials(displayName || membership.name)}
              </span>
            </button>
          </MemberMenu>
        </span>
      </div>

      {/* The copyable business number(s) — the same useful strip the desktop
          sidebar shows, so a mobile user can read + copy their number, see
          every number when they have more than one, and get an HONEST failed
          state (never "Setting up…" over a real failure). */}
      <div className="border-t border-app-line-soft px-3 py-1.5">
        <WorkspaceNumbers numbers={numberRows} />
      </div>
    </header>
  );
}
