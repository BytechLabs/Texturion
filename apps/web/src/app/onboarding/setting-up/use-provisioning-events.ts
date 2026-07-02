"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { keys } from "@/lib/api/keys";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

/**
 * Realtime for the setting-up checklist (SPEC §8, G7 step 6). The app-shell
 * RealtimeProvider only mounts inside the (app) group, so this screen opens
 * its own private `company:{id}` Broadcast channel and re-reads the sources
 * of truth on `number.updated` / `registration.updated` — ID-only payloads,
 * state always refetched through the API.
 */
export function useProvisioningEvents(companyId: string | null): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!companyId) return;
    const supabase = getSupabaseBrowser();
    let disposed = false;

    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: keys.me });
      queryClient.invalidateQueries({
        queryKey: keys.company(companyId),
        refetchType: "active",
      });
      queryClient.invalidateQueries({
        queryKey: keys.registration(companyId),
        refetchType: "active",
      });
      queryClient.invalidateQueries({
        queryKey: keys.numbers(companyId),
        refetchType: "active",
      });
    };

    // Private-topic auth rides the Supabase session token (SPEC §8).
    const {
      data: { subscription: authSubscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        void supabase.realtime.setAuth(session.access_token);
      }
    });

    const channel = supabase.channel(`company:${companyId}`, {
      config: { private: true },
    });
    channel
      .on("broadcast", { event: "number.updated" }, invalidate)
      .on("broadcast", { event: "registration.updated" }, invalidate);

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (disposed) return;
      if (data.session?.access_token) {
        await supabase.realtime.setAuth(data.session.access_token);
      }
      channel.subscribe((status) => {
        // Anything missed while disconnected is re-read on resubscribe.
        if (status === "SUBSCRIBED") invalidate();
      });
    })();

    return () => {
      disposed = true;
      authSubscription.unsubscribe();
      void supabase.removeChannel(channel);
    };
  }, [companyId, queryClient]);
}
