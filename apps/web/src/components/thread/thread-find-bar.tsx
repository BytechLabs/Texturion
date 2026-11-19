"use client";

import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { useT } from "@/i18n/provider";
import { useFindThreadMessages } from "@/lib/api/messages";

export function ThreadFindBar({
  conversationId,
  initialQuery,
  initialMessage,
  onJump,
  onClose,
}: {
  conversationId: string;
  initialQuery: string;
  initialMessage: string | null;
  onJump: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const field = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState(initialMessage);
  useEffect(() => {
    field.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), 250);
    return () => clearTimeout(timer);
  }, [input]);

  const find = useFindThreadMessages(conversationId, query);
  const matches = input.trim() === query ? find.data?.data ?? [] : [];
  const index = matches.findIndex((match) => match.id === selected);
  const count = matches.length;
  function step(direction: number) {
    if (!count) return;
    const current = index === -1 && direction < 0 ? 0 : index;
    const match = matches[(current + direction + count) % count];
    setSelected(match.id);
    onJump(match.id);
  }
  let status = "";
  if (input.trim() && input.trim() === query) {
    if (find.isFetching) status = t("thread.findSearching");
    else if (find.isError) status = t("thread.findError");
    else if (find.data) {
      const total = find.data.truncated ? `${count}+` : String(count);
      status = index === -1
        ? t("thread.findMatches", { count: total })
        : t("thread.findPosition", { position: index + 1, count: total });
    }
  }

  return (
    <div className="shrink-0 border-b border-app-line bg-app-paper px-3 py-2">
      <div className="mx-auto flex max-w-[42rem] flex-wrap items-center gap-1">
        <SearchField
          ref={field}
          containerClassName="min-w-32 flex-1"
          aria-label={t("thread.findInThread")}
          placeholder={t("thread.findInThread")}
          maxLength={200}
          value={input}
          onValueChange={(value) => {
            setInput(value);
            setSelected(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
            if (event.key === "Enter") {
              event.preventDefault();
              step(event.shiftKey ? -1 : 1);
            }
          }}
        />
        <span role="status" className="text-xs text-muted-foreground">{status}</span>
        <Button variant="ghost" size="icon-sm" disabled={count === 0}
          aria-label={t("thread.findPrevious")} onClick={() => step(-1)}>
          <ChevronUp className="size-4" aria-hidden />
        </Button>
        <Button variant="ghost" size="icon-sm" disabled={count === 0}
          aria-label={t("thread.findNext")} onClick={() => step(1)}>
          <ChevronDown className="size-4" aria-hidden />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={t("thread.findClose")} onClick={onClose}>
          <X className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
