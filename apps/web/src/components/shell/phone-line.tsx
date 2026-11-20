"use client";

import { Check, ChevronDown, Copy, Phone } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCopyPhoneNumber } from "@/components/ui/copyable-phone-number";
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

export function PhoneLinePicker({ rail = false, className }: { rail?: boolean; className?: string }) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const { lines, selected, select } = usePhoneLine();
  const copyPhoneNumber = useCopyPhoneNumber();

  if (!selected) return null;
  const label = t("shell.phoneLineNamed", { name: selected.name });
  const trigger = (
    <button
      type="button"
      aria-label={rail ? label : `${label}${selected.name === selected.number ? "" : `, ${selected.number}`}`}
      className={cn(
        "flex h-10 w-full items-center gap-2.5 rounded-[9px] text-left text-app-ink-soft hover:bg-app-line-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        rail ? "justify-center" : "px-[11px]",
      )}
    >
      <Phone className={cn("shrink-0 text-app-muted", rail ? "size-5" : "size-4")} strokeWidth={1.75} aria-hidden />
      {!rail && (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{selected.name}</span>
            {selected.name !== selected.number && <span className="block truncate text-[11px] text-app-muted">{selected.number}</span>}
          </span>
          <ChevronDown className="size-3.5 shrink-0" aria-hidden />
        </>
      )}
    </button>
  );

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

  return (
    <div className={className}>
      <DropdownMenu>
        {rail ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ) : <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>}
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
          <DropdownMenuItem onSelect={() => void copyPhoneNumber(selected.e164)}>
            <Copy className="size-4" aria-hidden />
            {t("shell.copyNumber", { number: selected.number })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
