"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMe } from "@/lib/api/me";
import { useSessionReady } from "@/lib/auth/use-session-ready";
import {
  readCompanyCookie,
  resolveActiveCompanyId,
  writeCompanyCookie,
} from "@/lib/company/cookie";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

/**
 * The escape cluster for every full-screen authenticated gate (#207): the
 * workspace switcher + sign out that `GateHeader` mounts. Split from
 * gate-header.tsx so surfaces that only need the escape (CompanyProvider's
 * /me-error state) can import it without dragging in the Wordmark's
 * next/font dependency — node-environment tests that transitively import
 * those surfaces would otherwise fail on the font loader.
 *
 * Same mechanism as the in-app switcher, not a second implementation: the
 * active workspace is persisted in the jt-company cookie via the SAME
 * writeCompanyCookie/resolveActiveCompanyId pair CompanyProvider uses, and
 * navigation goes through the app home so CompanyProvider stays the single
 * arbiter of where the target workspace belongs (its own gate when not
 * onboarded, the app when it is).
 *
 * Gates live outside `.app-scope`, so this styles with the semantic shadcn
 * tokens (border, muted-foreground, ...) like the rest of the gate chrome —
 * the app-* tokens are inert here.
 */

/**
 * Switch the active workspace from a gate. Persists the choice exactly like
 * CompanyProvider.switchCompany (same cookie, same writer), then routes
 * through the app home: CompanyProvider re-resolves the target workspace and
 * lands the user in its correct state — the app when onboarded, back in
 * /onboarding when its checkout/setup is unfinished. No gate-side copy of that
 * routing logic. Selecting the already-active workspace only re-persists it —
 * no navigation, the user stays where they are.
 */
export function switchWorkspaceFromGate(
  targetId: string,
  activeId: string | null,
  router: { push: (href: string) => void },
): void {
  writeCompanyCookie(targetId);
  if (targetId !== activeId) router.push("/for-you");
}

/**
 * A quiet "Sign out" control for gate chrome. Mirrors the shell's MemberMenu
 * sign-out exactly: Supabase signOut, clear the query cache, /login. Kept calm
 * and secondary (muted, small) so it never competes with the one question on
 * screen (G7).
 */
export function GateSignOut() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await getSupabaseBrowser().auth.signOut();
      queryClient.clear();
      router.push("/login");
    } catch {
      // Sign-out is best-effort from the client; if the network blips, the
      // button re-enables so the user can try again.
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={busy}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
    >
      <LogOut className="size-3.5" strokeWidth={1.75} aria-hidden />
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}

/**
 * The escape cluster: current workspace (a switcher menu when the user belongs
 * to more than one) + Sign out. Renders nothing until a session exists — the
 * invite page serves signed-out visitors from the same layout, and they must
 * not see a "Sign out". Resolves the active workspace the same way the
 * onboarding wizard does (useMe + cookie), so both always agree.
 */
export function GateEscape({ className }: { className?: string }) {
  const router = useRouter();
  const sessionReady = useSessionReady();
  const me = useMe(sessionReady);

  const memberships = me.data?.memberships ?? [];
  const activeId = me.data
    ? resolveActiveCompanyId(memberships, readCompanyCookie())
    : null;
  const active = memberships.find((m) => m.company_id === activeId) ?? null;

  if (!sessionReady) return null;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {active && memberships.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Switch workspace"
            className="inline-flex h-8 max-w-[200px] items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-muted-foreground outline-none transition-colors duration-150 ease-out hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:text-foreground"
          >
            <span className="min-w-0 truncate">{active.name}</span>
            <ChevronsUpDown
              className="size-3.5 shrink-0"
              strokeWidth={1.75}
              aria-hidden
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            {memberships.map((m) => (
              <DropdownMenuItem
                key={m.company_id}
                onSelect={() =>
                  switchWorkspaceFromGate(m.company_id, activeId, router)
                }
              >
                <span className="min-w-0 flex-1 truncate">{m.name}</span>
                {m.company_id === activeId && (
                  <Check className="size-4 text-primary" strokeWidth={1.75} />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : active ? (
        // Single workspace: no menu to offer, but still SAY which workspace
        // this gate belongs to — the ambiguity is half of the trap.
        <span className="max-w-[200px] truncate px-2 text-[13px] text-muted-foreground">
          {active.name}
        </span>
      ) : null}
      <GateSignOut />
    </div>
  );
}
