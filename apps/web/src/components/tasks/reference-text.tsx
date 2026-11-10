"use client";

import { parseReferenceTokens, taskNumberLabel } from "@loonext/shared";
import { Check } from "lucide-react";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";

import { useT } from "@/i18n/provider";
import { useResolvedReferences } from "@/lib/api/task-links";
import type { ResolvedReferences } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * #690: text with its references drawn as chips.
 *
 * A reference is plain text in the saved words (`#T-142`), so this reads the
 * text, asks the server once what every token in it says right now, and swaps
 * each token it could resolve for a chip: the task's number and live title,
 * struck through when it is done; the customer's name; the conversation's
 * customer. A token that resolves to nothing (deleted, unknown, or on a number
 * this member may not see) stays exactly as typed.
 */
export function ReferenceText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const resolved = useResolvedReferences([text]);
  return (
    <span className={cn("whitespace-pre-wrap break-words", className)}>
      {renderWithChips(text, resolved.data)}
    </span>
  );
}

/** The chips for every reference in a text, as a row. For a field that is edited as plain text. */
export function ReferenceChips({ text, className }: { text: string; className?: string }) {
  const resolved = useResolvedReferences([text]);
  const chips = parseReferenceTokens(text)
    .map((token, i) => {
      const chip = chipFor(token.kind, token.key, resolved.data);
      return chip ? <Fragment key={`${token.start}-${i}`}>{chip}</Fragment> : null;
    })
    .filter((chip) => chip !== null);
  if (chips.length === 0) return null;
  return <div className={cn("flex flex-wrap gap-1.5", className)}>{chips}</div>;
}

function renderWithChips(text: string, data: ResolvedReferences | undefined): ReactNode[] {
  const out: ReactNode[] = [];
  let at = 0;
  for (const token of parseReferenceTokens(text)) {
    const chip = chipFor(token.kind, token.key, data);
    if (chip === null) continue;
    if (token.start > at) out.push(text.slice(at, token.start));
    out.push(<Fragment key={`${token.start}`}>{chip}</Fragment>);
    at = token.end;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

function chipFor(
  kind: "task" | "contact" | "conversation",
  key: string,
  data: ResolvedReferences | undefined,
): ReactNode | null {
  if (!data) return null;
  if (kind === "task") {
    const task = data.tasks.find((row) => String(row.number) === key);
    return task ? <TaskChip task={task} /> : null;
  }
  if (kind === "contact") {
    const contact = data.contacts.find((row) => row.prefix === key);
    return contact ? (
      <Chip href={`/contacts/${contact.id}`}>{contact.name ?? key}</Chip>
    ) : null;
  }
  const conversation = data.conversations.find((row) => row.prefix === key);
  return conversation ? (
    <Chip href={`/inbox/${conversation.id}`}>{conversation.contact_name ?? key}</Chip>
  ) : null;
}

function TaskChip({ task }: { task: ResolvedReferences["tasks"][number] }) {
  const t = useT();
  return (
    <Chip href={`/tasks?task=${task.id}`} done={task.done}>
      <span className="tabular-nums">{taskNumberLabel(task.number)}</span>{" "}
      <span className={cn(task.done && "line-through")}>{task.title}</span>
      {task.done && (
        <>
          <Check className="ml-1 inline size-3" strokeWidth={2} aria-hidden />
          <span className="sr-only">{t("tasks.statusDone")}</span>
        </>
      )}
    </Chip>
  );
}

function Chip({
  href,
  done = false,
  children,
}: {
  href: string;
  done?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "mx-0.5 inline-flex max-w-full items-center rounded-full border border-app-line bg-app-inset px-2 py-0.5 align-baseline text-[12px] font-medium leading-4 text-app-ink transition-colors hover:border-app-olive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        done && "text-app-muted",
      )}
    >
      <span className="truncate">{children}</span>
    </Link>
  );
}
