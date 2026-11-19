"use client";

import { useEffect, useState } from "react";

import { useT } from "@/i18n/provider";

const ANNOUNCEMENT_DELAY_MS = 250;

export function ResultsStatus({
  query,
  count,
}: {
  query?: string;
  count: number | null;
}) {
  const t = useT();
  const term = query?.trim();
  const message = term && count !== null
    ? t(count === 1 ? "shell.resultShown" : "shell.resultsShown", { count, query: term })
    : "";
  const [announced, setAnnounced] = useState("");

  useEffect(() => {
    const timeout = window.setTimeout(() => setAnnounced(message), ANNOUNCEMENT_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [message]);

  return (
    <span className="sr-only" role="status" aria-atomic="true">
      {message === announced ? announced : ""}
    </span>
  );
}
