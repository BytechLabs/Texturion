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

import { avatarInitials } from "./avatar-color";

/**
 * The top-bar avatar menu (APP-SHELL-REDESIGN §3, mockup .avatar): a petrol
 * gradient circle showing the user's initials, opening the account menu —
 * Settings, the theme toggle (System/Light/Dark), and Sign out. Every
 * destination the old sidebar UserMenu carried is preserved; Settings moves here
 * from the sidebar nav so it stays reachable on every app screen.
 */
export function AvatarMenu() {
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
      <DropdownMenuTrigger
        aria-label="Your account"
        className="grid size-[38px] shrink-0 place-items-center rounded-full text-[12.5px] font-bold text-white shadow-[0_1px_2px_rgba(11,79,73,0.4),inset_0_1px_0_rgba(255,255,255,0.18)] outline-none app-ava-self transition-transform duration-150 ease-out hover:brightness-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {avatarInitials(displayName || membership.name)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
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
