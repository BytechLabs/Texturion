"use client";

import { ChevronDown, Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { parseQuickAdd } from "@loonext/shared";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { createdToast } from "@/components/ui/created-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/provider";
import { useMe } from "@/lib/api/me";
import { browserTimezone, instantFromZonedWallClock } from "@/lib/format/time";
import { useTags } from "@/lib/api/tags";
import { useMembers } from "@/lib/api/team";
import { useAddTaskLabel, useCreateTaskFromMessage } from '@/lib/api/tasks';
import type { TaskAddressInput } from '@/lib/api/tasks';
import type { Contact, Tag, TaskPriority } from "@/lib/api/types";
import { useCompanyId } from "@/lib/company/provider";
import { cn } from "@/lib/utils";

import { AssigneeField } from "./assignee-field";
import { QuickAddPreview } from "./quick-add-preview";
import { TaskCustomerField, useCustomerConversation } from "./task-customer-field";
import { NO_CONVERSATION } from "./task-format";
import { draftProblem, draftToRequest } from './task-planning';
import type { RepeatDraft } from './task-planning';
import {
  EditableLabelChips,
  LabelPicker,
  PrioritySelect,
  RepeatField,
} from "./task-planning-ui";

const NEW_TASK_EVENT = "loonext:new-task";

/** Radix forbids an empty <Select> value, so "nobody" is this. */

/** What a New task control already knows, so the form can link it. */
export interface NewTaskContext {
  contactId?: string;
  conversationId?: string;
  /** Shown as "For {name}". */
  contactName?: string;
  address?: string | null;
  /** A due value (`yyyy-MM-ddTHH:mm`) to start with, e.g. from a calendar click. */
  due?: string;
  /** The IANA zone `due` is read in; the workspace's, not the device's. */
  timeZone?: string;
}

/** Ask the one New task dialog (mounted in the app shell) to open. */
export function openNewTask(context: NewTaskContext = {}) {
  window.dispatchEvent(new CustomEvent(NEW_TASK_EVENT, { detail: context }));
}

/** The New task control: the Tasks page, a contact and a conversation render this. */
export function NewTaskButton({
  context,
  variant = "outline",
  size = "sm",
  className,
}: {
  context?: NewTaskContext;
  variant?: "outline" | "default" | "ghost";
  size?: "sm" | "default";
  className?: string;
}) {
  const t = useT();
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={() => openNewTask(context)}
    >
      <Plus strokeWidth={1.75} aria-hidden />
      {t("tasks.newTask")}
    </Button>
  );
}

/** Mounted once. Opens on `openNewTask`, from any control or the palette. */
export function NewTaskDialog() {
  const t = useT();
  const [context, setContext] = useState<NewTaskContext | null>(null);

  useEffect(() => {
    const onOpen = (event: Event) => {
      setContext((event as CustomEvent<NewTaskContext>).detail ?? {});
    };
    window.addEventListener(NEW_TASK_EVENT, onOpen);
    return () => window.removeEventListener(NEW_TASK_EVENT, onOpen);
  }, []);

  return (
    <Dialog
      open={context !== null}
      onOpenChange={(open) => {
        if (!open) setContext(null);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("tasks.newTask")}</DialogTitle>
          <DialogDescription>{t("tasks.newTaskDescription")}</DialogDescription>
        </DialogHeader>
        {context && (
          <NewTaskForm context={context} onDone={() => setContext(null)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

const EMPTY_ADDRESS = {
  street: "",
  unit: "",
  city: "",
  state: "",
  postal_code: "",
  country: "",
};

/**
 * Title first and alone; assignee is me and due is empty (smart defaults).
 * Everything else sits under More so the common case is one field and Enter.
 */
function NewTaskForm({
  context,
  onDone,
}: {
  context: NewTaskContext;
  onDone: () => void;
}) {
  const t = useT();
  const me = useMe();
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [customer, setCustomer] = useState<Contact | null | undefined>(undefined);
  const thread = useCustomerConversation(customer ?? null);
  const conversationId = customer === undefined ? context.conversationId : thread.id;
  const contactId = customer === undefined ? context.contactId : customer?.id;
  const create = useCreateTaskFromMessage(conversationId ?? NO_CONVERSATION);

  const [title, setTitle] = useState("");
  // #689 A: the title line doubles as the quick-add line. What it understood is
  // shown under the field and applied when the task is created, never before.
  const members = useMembers();
  const tags = useTags();
  const parsed = useMemo(
    () =>
      parseQuickAdd(title, {
        now: new Date(),
        timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
        selfUserId: me.data?.user_id ?? "",
        members: (members.data?.data ?? [])
          .filter((m) => m.deactivated_at === null && m.user_id !== null)
          .map((m) => ({ userId: m.user_id, name: m.display_name })),
        labels: (tags.data?.data ?? []).map((tag) => ({ id: tag.id, name: tag.name })),
      }),
    [title, me.data?.user_id, members.data, tags.data],
  );
  // A prefilled due opens More so the date it chose is on screen, not hidden.
  const [moreOpen, setMoreOpen] = useState(context.due !== undefined);
  const [crewOverride, setCrewOverride] = useState<string[] | null>(null);
  const crew = crewOverride ?? (me.data ? [me.data.user_id] : []);
  const [due, setDue] = useState(context.due ?? "");
  const [dateOnly, setDateOnly] = useState(context.due?.length === 10);
  const dueZone = context.timeZone;
  const [notes, setNotes] = useState("");
  const [addr, setAddr] = useState({ ...EMPTY_ADDRESS, street: context.address ?? "" });
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [pickedTags, setPickedTags] = useState<Tag[]>([]);
  // A name typed for a tag that does not exist yet. The tag is made when it is
  // attached, so these are attached right after the task is created.
  const [newNames, setNewNames] = useState<string[]>([]);
  const [repeat, setRepeat] = useState<RepeatDraft | null>(null);
  const addLabel = useAddTaskLabel(conversationId ?? NO_CONVERSATION);
  const linked = conversationId !== undefined || contactId !== undefined;

  const submit = async () => {
    if (thread.pending) return;
    const trimmed = parsed.title.trim();
    if (trimmed === "") {
      toast.error(t("tasks.newTaskTitleRequired"));
      return;
    }
    // What the line set wins over the form's defaults and over More.
    const finalCrew = parsed.assignee ? [parsed.assignee.userId] : crew;
    const finalDay = parsed.dueOn ?? (!parsed.dueAt && dateOnly && due ? due : null);
    let finalDue = finalDay ? null : parsed.dueAt;
    if (!finalDay && finalDue === null && due !== "") {
      if (dueZone) {
        const zoned = instantFromZonedWallClock(due, dueZone);
        if (!zoned.ok) {
          toast.error(t("tasks.newTaskDueInvalid"));
          return;
        }
        finalDue = zoned.iso;
      } else {
        finalDue = new Date(due).toISOString();
      }
    }
    const finalPriority = parsed.priority ?? priority;
    const finalLabelIds = [
      ...new Set([...pickedTags.map((tag) => tag.id), ...parsed.labels.map((l) => l.id)]),
    ];
    if (repeat) {
      const problem = draftProblem(repeat, finalDue ?? finalDay);
      if (problem) {
        toast.error(t(problem));
        return;
      }
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
          provenance: "manual",
        }
      : null;
    try {
      const created = await create.mutateAsync({
        title: trimmed,
        // Until `me` loads, leave it out so the API assigns the creator.
        ...(crewOverride === null && !me.data && !parsed.assignee ? {} : { assignee_ids: finalCrew }),
        ...(finalDue === null ? {} : { due_at: finalDue }),
        ...(finalDay === null ? {} : { due_on: finalDay }),
        ...(notes.trim() === "" ? {} : { description: notes.trim() }),
        ...(address ? { address } : {}),
        // The conversation fixes the contact, so send one link, not both.
        ...(conversationId === undefined
          ? (contactId === undefined
            ? {}
            : { contact_id: contactId })
          : { conversation_id: conversationId }),
        ...(finalPriority === "normal" ? {} : { priority: finalPriority }),
        ...(finalLabelIds.length > 0 ? { label_ids: finalLabelIds } : {}),
        ...(repeat ? { repeat: draftToRequest(repeat, finalDue ?? finalDay) } : {}),
      });
      // The task exists now; a label that fails to attach must not undo it.
      let labelFailed = false;
      for (const name of newNames) {
        try {
          await addLabel.mutateAsync({ taskId: created.id, name });
        } catch {
          labelFailed = true;
        }
      }
      if (labelFailed) toast.error(t("tasks.labelAddFailed"));
      if (contactId !== undefined) {
        void queryClient.invalidateQueries({
          queryKey: [companyId, "record-activity", "contact", contactId],
        });
      }
      createdToast({
        message: t("tasks.newTaskCreated"),
        openLabel: t("common.open"),
        onOpen: () => router.push(`/tasks?task=${created.id}`),
      });
      onDone();
    } catch {
      toast.error(t("tasks.newTaskFailed"));
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-task-title">{t("tasks.newTaskTitleLabel")}</Label>
        <Input
          id="new-task-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          autoFocus
          maxLength={500}
          placeholder={t("tasks.newTaskTitlePlaceholder")}
        />
        <QuickAddPreview parsed={parsed} />
        {title.trim() === "" && (
          <p className="text-[12px] text-muted-foreground">{t("tasks.quickAddHint")}</p>
        )}
      </div>

      <TaskCustomerField id="new-task-customer"
        name={customer === undefined ? (context.contactName ?? (context.conversationId ? t("tasks.newTaskInThisConversation") : null)) : (customer?.name ?? customer?.phone_e164)}
        onSelect={(next) => {
          setCustomer(next);
          setAddr((current) => ({
            ...current,
            street: current.street === "" || current.street === (customer?.address ?? context.address)
              ? (next?.address ?? "")
              : current.street,
          }));
        }} />

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
          aria-expanded={moreOpen}
          aria-controls="new-task-more"
          className="flex min-h-11 items-center gap-1.5 self-start rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
        >
          {t("tasks.newTaskMore")}
          <ChevronDown
            className={cn(
              "size-4 transition-transform",
              moreOpen && "rotate-180",
            )}
            aria-hidden
          />
        </button>
        {moreOpen && (
          <div id="new-task-more" className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-task-assignee">{t("tasks.assignee")}</Label>
              <AssigneeField
                id="new-task-assignee"
                ariaLabel={t("tasks.assignee")}
                value={crew}
                onCommit={setCrewOverride}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-task-due">{t("tasks.due")}</Label>
              <Input
                id="new-task-due"
                type={dateOnly ? "date" : "datetime-local"}
                value={due}
                onChange={(event) => setDue(event.target.value)}
              />
              <div className="flex min-h-11 items-center gap-2 md:min-h-0">
                <Checkbox
                  id="new-task-any-time"
                  checked={dateOnly}
                  onCheckedChange={(checked) => {
                    const nextDateOnly = checked === true;
                    setDateOnly(nextDateOnly);
                    setDue(nextDateOnly ? due.slice(0, 10) : "");
                  }}
                />
                <Label htmlFor="new-task-any-time">{t("tasks.anyTime")}</Label>
              </div>
              {dueZone && dueZone !== browserTimezone() && (
                <p className="text-[12px] text-muted-foreground">
                  {t("tasks.newTaskDueZone", { zone: dueZone.replaceAll('_', " ") })}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-task-priority">{t("tasks.priority")}</Label>
              <PrioritySelect
                id="new-task-priority"
                value={priority}
                onChange={setPriority}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t("tasks.labels")}</Label>
              <EditableLabelChips
                labels={[
                  ...pickedTags.map((tag) => ({ key: `id:${tag.id}`, name: tag.name })),
                  ...newNames.map((name) => ({ key: `name:${name}`, name })),
                ]}
                onRemove={(key) => {
                  if (key.startsWith("id:")) {
                    setPickedTags((tags) => tags.filter((tag) => `id:${tag.id}` !== key));
                  } else {
                    setNewNames((names) => names.filter((n) => `name:${n}` !== key));
                  }
                }}
              />
              <div>
                <LabelPicker
                  excludeIds={new Set(pickedTags.map((tag) => tag.id))}
                  excludeNames={newNames}
                  onPick={(tag) => setPickedTags((tags) => [...tags, tag])}
                  onCreate={(name) => setNewNames((names) => [...names, name])}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-task-repeat">{t("tasks.repeat")}</Label>
              <RepeatField
                id="new-task-repeat"
                draft={repeat}
                due={parsed.dueOn ?? parsed.dueAt ?? (due || null)}
                linked={linked}
                textingCustomer={conversationId ? { name: customer?.name ?? context.contactName } : undefined}
                existing={false}
                onChange={setRepeat}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-task-notes">{t("tasks.newTaskNotesLabel")}</Label>
              <Textarea
                id="new-task-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                maxLength={5000}
              />
            </div>
            <fieldset className="grid grid-cols-2 gap-2">
              <legend className="mb-1.5 text-sm font-medium">
                {t("thread.addressLabel")}
              </legend>
              <Input
                aria-label={t("thread.addrStreet")}
                className="col-span-2"
                placeholder={t("thread.addrStreet")}
                value={addr.street}
                onChange={(e) => setAddr({ ...addr, street: e.target.value })}
              />
              <Input
                aria-label={t("thread.addrUnitAria")}
                placeholder={t("thread.addrUnit")}
                value={addr.unit}
                onChange={(e) => setAddr({ ...addr, unit: e.target.value })}
              />
              <Input
                aria-label={t("thread.addrCity")}
                placeholder={t("thread.addrCity")}
                value={addr.city}
                onChange={(e) => setAddr({ ...addr, city: e.target.value })}
              />
              <Input
                aria-label={t("thread.addrStateAria")}
                placeholder={t("thread.addrState")}
                value={addr.state}
                onChange={(e) => setAddr({ ...addr, state: e.target.value })}
              />
              <Input
                aria-label={t("thread.addrPostalCode")}
                placeholder={t("thread.addrPostalCode")}
                value={addr.postal_code}
                onChange={(e) => setAddr({ ...addr, postal_code: e.target.value })}
              />
            </fieldset>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDone}
          disabled={create.isPending}
        >
          {t("common.cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={create.isPending || thread.pending}>
          {create.isPending ? t("thread.creating") : t("tasks.newTaskCreate")}
        </Button>
      </div>
    </form>
  );
}
