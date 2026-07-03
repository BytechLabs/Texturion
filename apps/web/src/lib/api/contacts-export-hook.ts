import { useMutation } from "@tanstack/react-query";

import { publicEnv } from "@/env";
import { useCompanyId } from "@/lib/company/provider";
import { getAccessToken } from "@/lib/supabase/browser";

import { fetchContactsExport, triggerBlobDownload } from "./contacts-export";

/**
 * Export the current contact list (honoring the active search `q`) and trigger
 * a download. Any member may export (read-only visibility, D20 §3.1). The
 * env + session wiring lives here; the env-free core is `contacts-export.ts`
 * (unit-tested without the browser).
 */
export function useExportContacts() {
  const companyId = useCompanyId();
  return useMutation({
    mutationFn: async (q: string) => {
      const { blob, filename } = await fetchContactsExport(companyId, q, {
        fetch,
        getToken: getAccessToken,
        baseUrl: publicEnv.NEXT_PUBLIC_API_URL,
      });
      triggerBlobDownload(blob, filename);
      return { filename };
    },
  });
}
