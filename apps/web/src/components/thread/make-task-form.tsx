"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError } from "@/lib/api/error";
import { useMe } from "@/lib/api/me";
import { useCreateTaskFromMessage } from "@/lib/api/tasks";
import { useMembers } from "@/lib/api/team";
import type { Message } from "@/lib/api/types";

import { messageTaskTitle } from "./make-task-title";

/** Sentinel <Select> value for "leave unassigned" (Radix forbids an empty string). */
const UNASSIGNED = "__unassigned__";

/**
 * T5.1: the compact INLINE prefilled promote form (replaces the old one-click
 * direct create). Prefills the title from the message snippet (editable),
 * defaults the assignee to the current user, and offers an optional due date.
 * The petrol "Create" calls POST /v1/tasks {message_id, title, assigned_user_id?,
 * due_at?}; a re-promote (409 conflict) surfaces "already a task". `onDone`
 * closes the surrounding Popover/menu.
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
  const createTask = useCreateTaskFromMessage(conversationId);

  const [title, setTitle] = useState(() => messageTaskTitle(message.body));
  const [due, setDue] = useState<string>("");
  // The assignee defaults to the current user (T5.1). We track an explicit
  // override separately so the default can follow `me` once it resolves without
  // a render-phase setState: null override = "use the me default".
  const [assigneeOverride, setAssigneeOverride] = useState<string | null>(null);
  const assignee =
    assigneeOverride ?? me.data?.user_id ?? UNASSIGNED;

  const submit = async () => {
    const trimmed = title.trim();
    if (trimmed === "") {
      toast.error("Give the task a title.");
      return;
    }
    try {
      await createTask.mutateAsync({
        message_id: message.id,
        title: trimmed,
        assigned_user_id: assignee === UNASSIGNED ? null : assignee,
        // <input type="datetime-local"> yields a local wall-clock string; convert
        // to an ISO instant for the API. Empty → no due date.
        due_at: due === "" ? null : new Date(due).toISOString(),
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
        <Label htmlFor="make-task-due">Due (optional)</Label>
        <Input
          id="make-task-due"
          type="datetime-local"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
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
