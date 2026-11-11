import { useMutation } from "@tanstack/react-query";

import { publicEnv } from "@/env";
import { useCompanyId } from "@/lib/company/provider";
import { getAccessToken } from "@/lib/supabase/browser";

import { triggerBlobDownload } from "./contacts-export";
import type { TaskListFilters } from "./task-filters";
import { fetchTasksExport } from "./tasks-export";

/** #745: download the tasks matching `filters` now. Creates no data export. */
export function useExportTasks() {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: async (filters: TaskListFilters) => {
      const { blob, filename } = await fetchTasksExport(companyId, filters, {
        fetch,
        getToken: getAccessToken,
        baseUrl: publicEnv.NEXT_PUBLIC_API_URL,
      });
      triggerBlobDownload(blob, filename);
      return { filename };
    },
  });
}
