"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveCompany } from "@/lib/company/provider";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * The company/user block at the bottom of the sidebar (G3): active workspace
 * + user, workspace switcher (multi-company users only), theme toggle
 * (System/Light/Dark — G2 dark mode ships in MVP), and sign out.
 */
export function UserMenu({ compact = false }: { compact?: boolean }) {
  const { membership, memberships, displayName, switchCompany } =
    useActiveCompany();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  async function signOut() {
    await getSupabaseBrowser().auth.signOut();
    queryClient.clear();
    router.push("/login");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex w-full items-center gap-2 rounded-md p-2 text-left outline-none transition-colors duration-150 ease-out hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring",
          compact && "justify-center",
        )}
        aria-label="Workspace and account menu"
      >
        <Avatar className="size-7">
          <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
            {initials(displayName || membership.name)}
          </AvatarFallback>
        </Avatar>
        {!compact && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {displayName || "You"}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {membership.name}
              </span>
            </span>
            <ChevronsUpDown
              className="size-4 shrink-0 text-muted-foreground"
              strokeWidth={1.75}
            />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={compact ? "right" : "top"}
        align="start"
        className="w-56"
      >
        {/* Single-company users never see a switcher (G12). */}
        {memberships.length > 1 && (
          <>
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
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme ?? "system"}
          onValueChange={setTheme}
        >
          <DropdownMenuRadioItem value="system">
            <Monitor className="size-4" strokeWidth={1.75} />
            System
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">
            <Sun className="size-4" strokeWidth={1.75} />
            Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="size-4" strokeWidth={1.75} />
            Dark
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut className="size-4" strokeWidth={1.75} />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
