"use client";

import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Monitor, Moon, Settings, Sun } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";

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

/**
 * The sidebar footer user-bar menu (issue #8, Discord-style): opens upward from
 * the account tile with the ONE Settings entry (its own sidebar row was
 * removed — Settings lives here, not in two places), the theme toggle
 * (System / Light / Dark), and Sign out. The trigger is supplied by the caller
 * (the account tile button) via `children`.
 */
export function MemberMenu({
  children,
  side = "top",
  align = "start",
}: {
  children: React.ReactNode;
  /** Menu placement — the footer account tile opens up (default). */
  side?: "top" | "bottom";
  align?: "start" | "end";
}) {
  const { displayName, membership } = useActiveCompany();
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
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side} className="w-56">
        <DropdownMenuLabel>
          <span className="block truncate text-sm font-medium">
            {displayName || "You"}
          </span>
          <span className="block truncate text-xs font-normal text-muted-foreground">
            {membership.name}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings className="size-4" strokeWidth={1.75} />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
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
