"use client";

import { Check, ChevronDown, ChevronsUpDown, Phone } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useId, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CopyablePhoneNumber, phoneCopyOnHover } from "@/components/ui/copyable-phone-number";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n/provider";
import { useMeCompany } from "@/lib/api/me-company";
import { useActiveCompany } from "@/lib/company/provider";
import { formatPhone } from "@/lib/format/phone";
import { updateSearch } from "@/lib/url/search-state";
import { cn } from "@/lib/utils";

interface PhoneLine {
  id: string;
  number: string;
  name: string;
  e164: string;
}

interface PhoneLineSelection {
  lines: PhoneLine[];
  selected: PhoneLine | undefined;
  select: (id: string) => void;
}

const PhoneLineContext = createContext<PhoneLineSelection>({
  lines: [],
  selected: undefined,
  select: () => {},
});

function readSelection(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function PhoneLineProvider({ children }: { children: React.ReactNode }) {
  const { companyId, userId } = useActiveCompany();
  const me = useMeCompany();
  const key = `loonext:phone-line:${userId}:${companyId}`;
  const [selections, setSelections] = useState<Record<string, string>>({});
  const numbers = me.data?.company?.numbers;
  const lines = useMemo(() => (numbers ?? []).flatMap((number) => {
    if (number.status !== "active" || !number.number_e164) return [];
    const formatted = formatPhone(number.number_e164);
    return [{ id: number.id, number: formatted, name: number.label?.trim() || formatted, e164: number.number_e164 }];
  }), [numbers]);
  const saved = selections[key] ?? readSelection(key);
  const selected = lines.find((line) => line.id === saved) ?? lines[0];

  const select = useCallback((id: string) => {
    if (!lines.some((line) => line.id === id)) return;
    setSelections((previous) => previous[key] === id ? previous : { ...previous, [key]: id });
    try {
      window.localStorage.setItem(key, id);
    } catch {
      // The selection still lives in this session.
    }
  }, [key, lines]);
  const value = useMemo(() => ({ lines, selected, select }), [lines, selected, select]);

  return (
    <PhoneLineContext.Provider value={value}>
      {children}
    </PhoneLineContext.Provider>
  );
}

export function usePhoneLine() {
  return useContext(PhoneLineContext);
}

export function PhoneLineNavigation({ children, rail = false }: { children: ReactNode; rail?: boolean }) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const { lines, selected, select } = usePhoneLine();
  const groupId = useId();
  const [closedOn, setClosedOn] = useState<string | null>(null);
  const open = closedOn !== pathname;

  if (!selected) return children;

  function choose(id: string) {
    if (id === selected?.id) return;
    select(id);
    if (pathname.startsWith("/inbox/") && pathname !== "/inbox/scheduled") {
      router.replace("/inbox");
    } else if (pathname.startsWith("/calls/")) {
      router.replace("/calls");
    } else if (pathname === "/inbox") {
      updateSearch((params) => {
        if (params.has("line")) params.set("line", id);
      });
    }
  }

  const switchLabel = t("shell.switchNumber");
  const switcher = (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            aria-label={switchLabel}
            className={cn(
              "tap-target grid shrink-0 place-items-center rounded-lg text-app-muted hover:bg-app-line-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              rail ? "h-10 w-full" : "size-11 lg:h-9 lg:w-7",
            )}
          >
            {rail ? <Phone className="size-5" aria-hidden /> : <ChevronsUpDown className="size-4" aria-hidden />}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side={rail ? "right" : "top"}>{rail ? `${switchLabel} · ${selected.name}` : switchLabel}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side={rail ? "right" : "bottom"} align="start" className="w-56">
        {lines.map((line) => (
          <DropdownMenuItem key={line.id} onSelect={() => choose(line.id)} aria-current={line.id === selected.id ? "true" : undefined}>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{line.name}</span>
              {line.name !== line.number && <span className="block truncate text-xs text-muted-foreground">{line.number}</span>}
            </span>
            {line.id === selected.id && <Check className="size-4" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (rail) return <div className="space-y-px">{lines.length > 1 && switcher}{children}</div>;

  return (
    <div>
      <div className="group/phone mb-1 flex items-center gap-0.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={groupId}
          onClick={() => setClosedOn(open ? pathname : null)}
          className="tap-target flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-[9px] px-2.5 text-left text-app-ink-soft hover:bg-app-line-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-10"
        >
          <Phone className="size-4 shrink-0 text-app-muted" strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{selected.name}</span>
            {selected.name !== selected.number && <span className="block truncate text-[11px] text-app-muted">{selected.number}</span>}
          </span>
          <ChevronDown className={cn("size-3.5 shrink-0", !open && "-rotate-90")} aria-hidden />
        </button>
        <CopyablePhoneNumber
          number={selected.e164}
          iconOnly
          className={cn("grid size-11 shrink-0 place-items-center rounded-lg text-app-muted hover:bg-app-line-soft lg:h-9 lg:w-7", phoneCopyOnHover)}
        />
        {lines.length > 1 && switcher}
      </div>
      <div id={groupId} hidden={!open}>{children}</div>
    </div>
  );
}
