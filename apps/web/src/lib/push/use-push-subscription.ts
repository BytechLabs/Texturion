"use client";

/**
 * usePushSubscription — the cross-track Web Push hook (G8/G9, SPEC §8),
 * consumed by /settings/notifications via components/notifications/
 * permission-card.tsx.
 *
 * A thin React binding over the framework-free machine in
 * subscription-machine.ts (unit-tested there with a stubbed PushManager):
 * permission state, subscribe/unsubscribe against POST/DELETE
 * /v1/push-subscriptions, with the VAPID application key read from
 * GET /v1/notification-prefs (`vapid_public_key` — exposed by
 * apps/api/src/routes/notifications.ts, so key rotation never needs a
 * frontend rebuild).
 *
 * G8: `subscribe()` triggers the browser permission prompt — call it ONLY
 * from an explicit user action (the settings card / first-visit card),
 * never on mount. Mounting the hook is read-only.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch } from "@/lib/api/client";
import type { NotificationPrefs, PushSubscriptionRow } from "@/lib/api/types";
import { useCompanyId } from "@/lib/company/provider";

import { ensureServiceWorkerRegistration, pushSupported } from "./register";
import {
  createPushMachine,
  type PushMachine,
  type PushPermission,
  type PushPhase,
  type PushSnapshot,
  type SubscriptionKeys,
} from "./subscription-machine";

export type { PushPermission, PushPhase };

/** GET /v1/notification-prefs response (prefs + the VAPID application key). */
interface PrefsWithVapidKey extends NotificationPrefs {
  vapid_public_key?: string;
}

export interface PushSubscriptionState {
  /** This browser has the SW + Push + Notification stack. */
  supported: boolean;
  permission: PushPermission;
  /** This device currently receives JobText pushes. */
  subscribed: boolean;
  /** True while the initial inspection or a subscribe/unsubscribe runs. */
  pending: boolean;
  /** Customer-facing sentence for the last failed action (G10), or null. */
  error: string | null;
  /** Full machine phase for state-specific UI. */
  phase: PushPhase;
  /** Call from a click only (G8) — prompts, subscribes, saves server-side. */
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

export function usePushSubscription(): PushSubscriptionState {
  const companyId = useCompanyId();
  // The machine is created once; read the company through a ref so a
  // workspace switch never leaves stale headers in its callbacks.
  const companyIdRef = useRef(companyId);
  companyIdRef.current = companyId;

  // Always start at "initializing" so server render and client hydration
  // agree (pushSupported() differs between them); init() resolves the truth
  // in the mount effect below.
  const [snapshot, setSnapshot] = useState<PushSnapshot>(() => ({
    phase: "initializing",
    permission: "default",
    error: null,
  }));

  const machineRef = useRef<PushMachine | null>(null);
  if (machineRef.current === null) {
    machineRef.current = createPushMachine(
      {
        supported: pushSupported(),
        getPermission: () => Notification.permission,
        requestPermission: () => Notification.requestPermission(),
        getPushManager: async () =>
          (await ensureServiceWorkerRegistration()).pushManager,
        fetchVapidPublicKey: async () => {
          const prefs = await apiFetch<PrefsWithVapidKey>(
            "/v1/notification-prefs",
            { companyId: companyIdRef.current },
          );
          if (!prefs.vapid_public_key) {
            throw new Error(
              "Notifications aren't configured yet. Try again later.",
            );
          }
          return prefs.vapid_public_key;
        },
        saveSubscription: (input: SubscriptionKeys) =>
          apiFetch<PushSubscriptionRow>("/v1/push-subscriptions", {
            method: "POST",
            companyId: companyIdRef.current,
            body: input,
          }),
        deleteSubscription: (id: string) =>
          apiFetch<void>(`/v1/push-subscriptions/${id}`, {
            method: "DELETE",
            companyId: companyIdRef.current,
          }),
      },
      setSnapshot,
    );
  }

  useEffect(() => {
    // Read-only inspection (support, permission, existing subscription) —
    // never prompts (G8).
    void machineRef.current?.init();
  }, []);

  const subscribe = useCallback(
    () => machineRef.current?.subscribe() ?? Promise.resolve(),
    [],
  );
  const unsubscribe = useCallback(
    () => machineRef.current?.unsubscribe() ?? Promise.resolve(),
    [],
  );

  return {
    supported: snapshot.phase !== "unsupported",
    permission: snapshot.permission,
    subscribed:
      snapshot.phase === "subscribed" || snapshot.phase === "unsubscribing",
    pending:
      snapshot.phase === "initializing" ||
      snapshot.phase === "subscribing" ||
      snapshot.phase === "unsubscribing",
    error: snapshot.error,
    phase: snapshot.phase,
    subscribe,
    unsubscribe,
  };
}
