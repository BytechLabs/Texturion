"use client";

import { useState } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SimpleSelect } from "@/components/ui/simple-select";
import { useT } from "@/i18n/provider";
import { apiFetch } from "@/lib/api/client";
import { ApiError } from "@/lib/api/error";
import type { Page } from "@/lib/api/types";
import { useCompanyId } from "@/lib/company/provider";

const fileKinds = ["attachment", "mms", "voicemail"] as const;
type FileKind = (typeof fileKinds)[number];
const kindLabels = {
  attachment: "settings.exportMediaAttachments",
  mms: "settings.exportMediaMessages",
  voicemail: "settings.exportMediaVoicemail",
} as const;

interface ExportFile {
  id: string;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
}

export function ExportDataFiles({ exportId }: { exportId: string }) {
  const t = useT();
  const companyId = useCompanyId();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FileKind>("attachment");
  const endpoint = "/v1/exports/" + exportId + "/media";
  const files = useInfiniteQuery({
    queryKey: [companyId, "export-media", exportId, kind],
    enabled: open,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ kind });
      if (pageParam) params.set("after", pageParam);
      return apiFetch<Page<ExportFile>>(endpoint + "?" + params, { companyId });
    },
    getNextPageParam: (page) => page.next_cursor,
  });
  const download = useMutation({
    mutationFn: ({ kind, id }: { kind: FileKind; id: string }) =>
      apiFetch<{ url: string }>(endpoint + "/" + kind + "/" + id, { companyId }),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (error) => toast.error(
      error instanceof ApiError ? error.message : t("settings.exportMediaDownloadFailed"),
    ),
  });
  const data = files.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)} className="space-y-2">
      <summary className="cursor-pointer text-sm font-medium">
        {t("settings.exportMediaTitle")}
      </summary>
      {open && (
        <>
          <div className="flex items-center gap-2 text-sm">
            {t("settings.exportMediaType")}
            <SimpleSelect
              ariaLabel={t("settings.exportMediaType")}
              className="w-auto"
              size="sm"
              value={kind}
              onValueChange={(value) => {
                const selected = fileKinds.find((fileKind) => fileKind === value);
                if (selected) setKind(selected);
              }}
              options={fileKinds.map((value) => ({ value, label: t(kindLabels[value]) }))}
            />
          </div>
          {files.isPending ? (
            <p role="status" className="text-sm text-muted-foreground">{t("settings.exportMediaLoading")}</p>
          ) : files.isError ? (
            <Button variant="outline" size="sm" onClick={() => void files.refetch()}>
              {t("settings.exportMediaRetry")}
            </Button>
          ) : data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("settings.exportMediaEmpty")}</p>
          ) : (
            <ul className="space-y-1">
              {data.map((file) => (
                <li key={file.id}>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={download.isPending}
                    onClick={() => download.mutate({ kind, id: file.id })}
                  >
                    <Download aria-hidden />
                    {file.file_name ?? file.content_type ?? t(kindLabels[kind])}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {files.hasNextPage && (
            <Button
              variant="outline"
              size="sm"
              disabled={files.isFetchingNextPage}
              onClick={() => void files.fetchNextPage()}
            >
              {t("settings.exportMediaMore")}
            </Button>
          )}
        </>
      )}
    </details>
  );
}
