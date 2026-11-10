"use client";

import { ChevronDown, Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/provider";
import { useMe } from "@/lib/api/me";
import {
  useAddTaskLabel,
  useCreateTaskFromMessage,
  type TaskAddressInput,
} from "@/lib/api/tasks";
import type { Tag, TaskPriority } from "@/lib/api/types";
import { useMembers } from "@/lib/api/team";
import { useCompanyId } from "@/lib/company/provider";
import { cn } from "@/lib/utils";

import { NO_CONVERSATION } from "./task-format";
import { draftProblem, draftToRequest, type RepeatDraft } from "./task-planning";
import {
  EditableLabelChips,
  LabelPicker,
  PrioritySelect,
  RepeatField,
} from "./task-planning-ui";

const NEW_TASK_EVENT = "loonext:new-task";

/** Radix forbids an empty <Select> value, so "nobody" is this. */
const UNASSIGNED = "__unassigned__";

/** What a New task control already knows, so the form can link it. */
export interface NewTaskContext {
  contactId?: string;
  conversationId?: string;
  /** Shown as "For {name}". */
  contactName?: string;
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
  const members = useMembers();
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  const create = useCreateTaskFromMessage(
    context.conversationId ?? NO_CONVERSATION,
  );

  const [title, setTitle] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [assigneeOverride, setAssigneeOverride] = useState<string | null>(null);
  const assignee = assigneeOverride ?? me.data?.user_id ?? UNASSIGNED;
  const [due, setDue] = useState("");
  const [notes, setNotes] = useState("");
  const [addr, setAddr] = useState(EMPTY_ADDRESS);
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [pickedTags, setPickedTags] = useState<Tag[]>([]);
  // A name typed for a tag that does not exist yet. The tag is made when it is
  // attached, so these are attached right after the task is created.
  const [newNames, setNewNames] = useState<string[]>([]);
  const [repeat, setRepeat] = useState<RepeatDraft | null>(null);
  const addLabel = useAddTaskLabel(context.conversationId ?? NO_CONVERSATION);
  const linked =
    context.conversationId !== undefined || context.contactId !== undefined;

  const link =
    context.conversationId !== undefined
      ? t("tasks.newTaskInThisConversation")
      : context.contactName
        ? t("tasks.newTaskFor", { name: context.contactName })
        : null;

  const submit = async () => {
    const trimmed = title.trim();
    if (trimmed === "") {
      toast.error(t("tasks.newTaskTitleRequired"));
      return;
    }
    if (repeat) {
      const problem = draftProblem(repeat, due === "" ? null : due);
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
        ...(assigneeOverride === null && !me.data
          ? {}
          : { assigned_user_id: assignee === UNASSIGNED ? null : assignee }),
        ...(due === "" ? {} : { due_at: new Date(due).toISOString() }),
        ...(notes.trim() === "" ? {} : { description: notes.trim() }),
        ...(address ? { address } : {}),
        // The conversation fixes the contact, so send one link, not both.
        ...(context.conversationId !== undefined
          ? { conversation_id: context.conversationId }
          : context.contactId !== undefined
            ? { contact_id: context.contactId }
            : {}),
        ...(priority === "normal" ? {} : { priority }),
        ...(pickedTags.length > 0
          ? { label_ids: pickedTags.map((tag) => tag.id) }
          : {}),
        ...(repeat ? { repeat: draftToRequest(repeat, due === "" ? null : due) } : {}),
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
      if (context.contactId !== undefined) {
        void queryClient.invalidateQueries({
          queryKey: [companyId, "contact-timeline", context.contactId],
        });
      }
      toast.success(t("tasks.newTaskCreated"));
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
        {link && <p className="text-[12px] text-muted-foreground">{link}</p>}
      </div>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
          aria-expanded={moreOpen}
          aria-controls="new-task-more"
          className="flex items-center gap-1.5 self-start rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              <Select value={assignee} onValueChange={setAssigneeOverride}>
                <SelectTrigger id="new-task-assignee" className="w-full">
                  <SelectValue placeholder={t("tasks.unassigned")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>{t("tasks.unassigned")}</SelectItem>
                  {(members.data?.data ?? []).map((member) => (
                    <SelectItem key={member.id} value={member.user_id}>
                      {member.display_name}
                      {me.data?.user_id === member.user_id
                        ? t("thread.youSuffix")
                        : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-task-due">{t("tasks.due")}</Label>
              <Input
                id="new-task-due"
                type="datetime-local"
                value={due}
                onChange={(event) => setDue(event.target.value)}
              />
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
                due={due === "" ? null : due}
                linked={linked}
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
        <Button type="submit" size="sm" disabled={create.isPending}>
          {create.isPending ? t("thread.creating") : t("tasks.newTaskCreate")}
        </Button>
      </div>
    </form>
  );
}
