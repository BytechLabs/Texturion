"use client";

import { ChevronDown, Loader2, MapPin, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CountryDatalist } from "@/components/ui/country-datalist";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { enrichTaskFromMessage, useAiSettings } from "@/lib/api/ai-settings";
import { ApiError } from "@/lib/api/error";
import { useMe } from "@/lib/api/me";
import { useCreateTaskFromMessage, type TaskAddressInput } from "@/lib/api/tasks";
import { useMembers } from "@/lib/api/team";
import type { AddressProvenance, Message } from "@/lib/api/types";
import { useCompanyId } from "@/lib/company/provider";
import { cn } from "@/lib/utils";

import { messageTaskTitle } from "./make-task-title";

/** Sentinel <Select> value for "leave unassigned" (Radix forbids an empty string). */
const UNASSIGNED = "__unassigned__";

/**
 * Delay before applying enrichment results to form state — long enough to clear
 * the Popover's open transition + auto-focus, so a cached (instant) result never
 * setStates mid-open and dismisses the popover on reopen. The fetch is NOT
 * delayed (it overlaps the transition), only the state application.
 */
const ENRICH_APPLY_DELAY_MS = 300;

/** The 6 structured address fields as editable strings ("" = absent). */
interface AddressFields {
  street: string;
  unit: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}
const EMPTY_ADDRESS: AddressFields = {
  street: "",
  unit: "",
  city: "",
  state: "",
  postal_code: "",
  country: "",
};

/** #214 provenance badge copy — only shown for AI sources (not manual/null). */
function provenanceLabel(p: AddressProvenance | null): string | null {
  switch (p) {
    case "message":
      return "From the message";
    case "contact":
      return "From the contact";
    case "company":
      return "Inferred from area code";
    default:
      return null;
  }
}

/** A UTC ISO instant → a local <input type="datetime-local"> value. */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/**
 * T5.1 / #214: the compact INLINE prefilled promote form. Prefills the title
 * from the message snippet (editable), defaults the assignee to the current
 * user, offers an optional due date, and — when the company has opted into AI
 * enrichment (Settings → AI) — pre-fills a structured job address and/or a due
 * date/time inferred from the message text, each with a provenance badge and
 * fully editable (any edit marks the address "manual"). The petrol "Create"
 * calls POST /v1/tasks; a re-promote (409) surfaces "already a task".
 */
export function MakeTaskForm({
  message,
  conversationId,
  onDone,
}: {
  message: Message;
  conversationId: string;
  onDone: () => void;
}) {
  const me = useMe();
  const members = useMembers();
  const companyId = useCompanyId();
  const aiSettings = useAiSettings();
  const createTask = useCreateTaskFromMessage(conversationId);

  const [title, setTitle] = useState(() => messageTaskTitle(message.body));
  const [due, setDue] = useState<string>("");
  const [dueSuggested, setDueSuggested] = useState(false);
  const [assigneeOverride, setAssigneeOverride] = useState<string | null>(null);
  const assignee = assigneeOverride ?? me.data?.user_id ?? UNASSIGNED;

  const [addr, setAddr] = useState<AddressFields>(EMPTY_ADDRESS);
  const [addrProvenance, setAddrProvenance] = useState<AddressProvenance | null>(
    null,
  );
  const [addrOpen, setAddrOpen] = useState(false);
  const [enriching, setEnriching] = useState(false);

  // Enrich once, as soon as the company's AI settings resolve with a toggle on.
  const enrichedRef = useRef(false);
  useEffect(() => {
    if (enrichedRef.current) return;
    const settings = aiSettings.data;
    if (!settings) return;
    if (!settings.enrich_task_address && !settings.enrich_task_due) return;
    const text = message.body?.trim();
    if (!text) return;

    enrichedRef.current = true;
    let cancelled = false;
    // Kick the fetch off now (it overlaps the popover's open transition), but
    // apply EVERY resulting setState only after the transition + auto-focus have
    // settled. A synchronous session-cache hit (on reopen) would otherwise
    // setState WHILE this popover is opening, which disrupts Radix's focus scope
    // and dismisses it — the form "flashed open then vanished" on the 2nd open.
    // Deferring the state (never the fetch) fixes reopen with no first-open lag.
    const pending = enrichTaskFromMessage(companyId, {
      message_id: message.id,
      conversation_id: conversationId,
      text,
    });
    const timer = setTimeout(() => {
      if (cancelled) return;
      setEnriching(true);
      void pending
        .then((res) => {
          if (cancelled || res.enrichment_disabled) return;
          if (settings.enrich_task_due && res.due_at) {
            setDue(isoToLocalInput(res.due_at));
            setDueSuggested(true);
          }
          if (settings.enrich_task_address && res.address) {
            setAddr({
              street: res.address.street ?? "",
              unit: res.address.unit ?? "",
              city: res.address.city ?? "",
              state: res.address.state ?? "",
              postal_code: res.address.postal_code ?? "",
              country: res.address.country ?? "",
            });
            setAddrProvenance(res.address_provenance);
            setAddrOpen(true);
          }
        })
        .finally(() => {
          if (!cancelled) setEnriching(false);
        });
    }, ENRICH_APPLY_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [aiSettings.data, companyId, conversationId, message.id, message.body]);

  /** Editing any address field marks the whole address user-authored ("manual"). */
  function editAddr(field: keyof AddressFields, value: string) {
    setAddr((a) => ({ ...a, [field]: value }));
    setAddrProvenance("manual");
  }

  /** One-click dismissal of a suggested (or typed) address — wipes every field
   *  and drops the provenance badge, so a wrong AI suggestion is gone in one tap. */
  function clearAddress() {
    setAddr(EMPTY_ADDRESS);
    setAddrProvenance(null);
  }
  const hasAddressContent = Object.values(addr).some((v) => v.trim() !== "");

  const submit = async () => {
    const trimmed = title.trim();
    if (trimmed === "") {
      toast.error("Give the task a title.");
      return;
    }
    const hasAddress = Object.values(addr).some((v) => v.trim() !== "");
    const address: TaskAddressInput | null = hasAddress
      ? {
          street: addr.street.trim() || null,
          unit: addr.unit.trim() || null,
          city: addr.city.trim() || null,
          state: addr.state.trim() || null,
          postal_code: addr.postal_code.trim() || null,
          country: addr.country.trim() || null,
          provenance: addrProvenance ?? "manual",
        }
      : null;
    try {
      await createTask.mutateAsync({
        message_id: message.id,
        title: trimmed,
        assigned_user_id: assignee === UNASSIGNED ? null : assignee,
        // <input type="datetime-local"> yields a local wall-clock string; convert
        // to an ISO instant for the API. Empty → no due date.
        due_at: due === "" ? null : new Date(due).toISOString(),
        address,
      });
      toast.success("Made a task from this message.");
      onDone();
    } catch (error) {
      toast.error(
        error instanceof ApiError && error.code === "conflict"
          ? "This message is already a task."
          : "Couldn't make a task. Try again.",
      );
    }
  };

  const memberOptions = members.data?.data ?? [];
  const provLabel = provenanceLabel(addrProvenance);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="make-task-title">Task</Label>
        <Input
          id="make-task-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          maxLength={500}
          placeholder="What needs doing?"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="make-task-assignee">Assignee</Label>
        <Select value={assignee} onValueChange={setAssigneeOverride}>
          <SelectTrigger id="make-task-assignee" className="w-full">
            <SelectValue placeholder="Unassigned" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
            {memberOptions.map((member) => (
              <SelectItem key={member.id} value={member.user_id}>
                {member.display_name}
                {me.data?.user_id === member.user_id ? " (you)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Label htmlFor="make-task-due">Due (optional)</Label>
          {dueSuggested && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Sparkles className="size-3" aria-hidden /> Suggested
            </span>
          )}
        </div>
        <Input
          id="make-task-due"
          type="datetime-local"
          value={due}
          onChange={(e) => {
            setDue(e.target.value);
            setDueSuggested(false);
          }}
        />
      </div>

      {/* #214 structured job address — collapsible; auto-opens when enrichment
          suggests one, with a provenance badge; any edit marks it manual. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAddrOpen((o) => !o)}
            className="flex flex-1 items-center gap-2 rounded-md text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-expanded={addrOpen}
          >
            <MapPin className="size-4 text-muted-foreground" strokeWidth={1.75} />
            Address
            {enriching && (
              <Loader2
                className="size-3 animate-spin text-muted-foreground"
                aria-label="Looking for an address"
              />
            )}
            {provLabel && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
                <Sparkles className="size-3" aria-hidden />
                {provLabel}
              </span>
            )}
            <ChevronDown
              className={cn(
                "ml-auto size-4 text-muted-foreground transition-transform",
                addrOpen && "rotate-180",
              )}
              aria-hidden
            />
          </button>
          {/* One-click clear — dismisses a wrong AI suggestion (or a typo) whole. */}
          {hasAddressContent && (
            <button
              type="button"
              onClick={clearAddress}
              aria-label="Clear address"
              className="shrink-0 rounded-md px-1.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Clear
            </button>
          )}
        </div>
        {addrOpen && (
          <div className="grid grid-cols-2 gap-2">
            <Input
              aria-label="Street"
              className="col-span-2"
              placeholder="Street"
              value={addr.street}
              onChange={(e) => editAddr("street", e.target.value)}
            />
            <Input
              aria-label="Unit or suite"
              placeholder="Unit / suite"
              value={addr.unit}
              onChange={(e) => editAddr("unit", e.target.value)}
            />
            <Input
              aria-label="City"
              placeholder="City"
              value={addr.city}
              onChange={(e) => editAddr("city", e.target.value)}
            />
            <Input
              aria-label="State or province"
              placeholder="State / province"
              value={addr.state}
              onChange={(e) => editAddr("state", e.target.value)}
            />
            <Input
              aria-label="Postal code"
              placeholder="Postal code"
              value={addr.postal_code}
              onChange={(e) => editAddr("postal_code", e.target.value)}
            />
            <Input
              aria-label="Country"
              className="col-span-2"
              placeholder="Country"
              list="make-task-countries"
              autoComplete="country-name"
              value={addr.country}
              onChange={(e) => editAddr("country", e.target.value)}
            />
            <CountryDatalist id="make-task-countries" />
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDone}
          disabled={createTask.isPending}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={createTask.isPending}>
          {createTask.isPending ? "Creating…" : "Create"}
        </Button>
      </div>
    </form>
  );
}
