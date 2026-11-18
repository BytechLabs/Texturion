import type { Locale } from "@loonext/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { deadline } from "../http/deadline";
import { loadPushCopySettings } from "./deliver";

const CALL_COPY_TIMEOUT_MS = 750;

interface CallPushCopy {
  incoming: { title: string; body: string };
  transfer: { title: (sender: string | null) => string; body: string };
  answered: { title: string; body: (member: string | null) => string };
  voicemail: { title: string; body: (caller: string) => string };
  missed: { title: string; body: (caller: string) => string };
  unknownCaller: string;
}

export const CALL_PUSH_COPY: Record<Locale, CallPushCopy> = {
  en: {
    incoming: { title: "Incoming call", body: "Someone is calling your business number" },
    transfer: {
      title: (sender) => sender ? `Transfer from ${sender}` : "Incoming transfer",
      body: "A teammate is transferring a call to you",
    },
    answered: {
      title: "Call answered",
      body: (member) => member ? `${member} picked it up.` : "A teammate picked it up.",
    },
    voicemail: { title: "New voicemail", body: (caller) => `${caller} left a message.` },
    missed: { title: "Missed call", body: (caller) => `${caller} called and nobody picked up.` },
    unknownCaller: "Someone",
  },
  "fr-CA": {
    incoming: { title: "Appel entrant", body: "Quelqu’un appelle votre numéro professionnel" },
    transfer: {
      title: (sender) => sender ? `Appel transféré par ${sender}` : "Transfert entrant",
      body: "Un membre de l’équipe vous transfère un appel",
    },
    answered: {
      title: "Appel pris",
      body: (member) => member ? `${member} a répondu.` : "Un membre de l’équipe a répondu.",
    },
    voicemail: { title: "Nouveau message vocal", body: (caller) => `${caller} a laissé un message.` },
    missed: { title: "Appel manqué", body: (caller) => `${caller} a appelé. Personne n’a répondu.` },
    unknownCaller: "Quelqu’un",
  },
};

export async function loadCallPushCopySettings(db: SupabaseClient, companyId: string, userIds: string[]) {
  const limit = deadline(CALL_COPY_TIMEOUT_MS);
  try {
    return await loadPushCopySettings(db, companyId, userIds, limit.signal);
  } finally {
    limit.clear();
  }
}
