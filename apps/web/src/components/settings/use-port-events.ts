"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { keys } from "@/lib/api/keys";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

/**
 * Realtime for the Settings → Numbers port stepper (PORTING.md §8.2). The
 * app-shell RealtimeProvider re-reads `numbers`/`company`/`registration` on
 * `number.updated`/`registration.updated`, but not `port_requests` — and the
 * schema track adds a dedicated `port.updated {port_request_id, status,
 * messaging_port_status}` broadcast (§8.2). This hook subscribes to it on the
 * same `company:{id}` private channel and re-reads the port list + the company
 * (a P6 completion also flips the `phone_numbers` row) so the tracker advances
 * without a refresh — matching the setting-up screen's realtime pattern.
 */
export function usePortEvents(companyId: string): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let disposed = false;

    const invalidate = () => {
      queryClient.invalidateQueries({
        queryKey: keys.portRequests.all(companyId),
        refetchType: "active",
      });
      queryClient.invalidateQueries({
        queryKey: keys.company(companyId),
        refetchType: "active",
      });
      queryClient.invalidateQueries({
        queryKey: keys.numbers(companyId),
        refetchType: "active",
      });
    };

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
    // A P6 completion arrives as number.updated too — listen to both so a
    // voice-then-messaging port advances live.
    channel
      .on("broadcast", { event: "port.updated" }, invalidate)
      .on("broadcast", { event: "number.updated" }, invalidate);

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
