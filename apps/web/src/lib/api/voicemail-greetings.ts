/**
 * #309 — recorded voicemail greetings.
 *
 * The greeting has always been a text string spoken by TTS. This is the half
 * that lets an owner use their own voice instead — which for a two-person
 * outfit competing with a franchise is not a nicety, because a synthetic voice
 * is what a robocall sounds like.
 *
 * Selecting a greeting is NOT here. That lives on the identity route
 * (`useSetNumberIdentity`) and the company route, both of which already answer
 * "what does this line do".
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useCompanyId } from "@/lib/company/provider";

import { apiFetch } from "./client";

export interface VoicemailGreeting {
  id: string;
  name: string;
  duration_ms: number;
  mime_type: string;
  byte_size: number;
  created_at: string;
}

const keys = {
  all: (companyId: string) => ["voicemail-greetings", companyId] as const,
};

/** GET /v1/voicemail-greetings — what this workspace has recorded. */
export function useVoicemailGreetings(enabled = true) {
  const companyId = useCompanyId();
  return useQuery({
    queryKey: keys.all(companyId),
    queryFn: () =>
      apiFetch<{ data: VoicemailGreeting[] }>("/v1/voicemail-greetings", {
        companyId,
      }),
    enabled,
  });
}

/** Two minutes, the same ceiling the API and the column enforce. */
export const MAX_GREETING_MS = 120_000;

export interface RecordGreetingInput {
  name: string;
  blob: Blob;
  durationMs: number;
}

/** POST /v1/voicemail-greetings — multipart, the same door attachments use. */
export function useRecordGreeting() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, blob, durationMs }: RecordGreetingInput) => {
      const form = new FormData();
      form.set("name", name);
      form.set("duration_ms", String(Math.round(durationMs)));
      // A filename is required by some servers' multipart parsers even when
      // nothing reads it; the extension follows the recorder's own MIME type.
      form.set("file", blob, `greeting.${extensionFor(blob.type)}`);
      return apiFetch<VoicemailGreeting>("/v1/voicemail-greetings", {
        method: "POST",
        companyId,
        formData: form,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.all(companyId) });
    },
  });
}

/** DELETE — and every line that was using it goes back to the written words. */
export function useDeleteGreeting() {
  const companyId = useCompanyId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/v1/voicemail-greetings/${id}`, {
        method: "DELETE",
        companyId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.all(companyId) });
      // A number's identity carries its selection, and deleting the recording
      // cleared it server-side (the FK's `on delete set null`). Anything
      // showing that selection is now wrong.
      void queryClient.invalidateQueries({ queryKey: ["number-identity"] });
    },
  });
}

/**
 * The recorder's MIME type, as a file extension.
 *
 * Browsers disagree about what they produce — Chrome gives webm/opus, Safari
 * gives mp4/aac — and the type can carry a codec suffix. Split it off rather
 * than trusting the whole string to match a map.
 */
export function extensionFor(mimeType: string): string {
  const base = (mimeType || "").split(";")[0]!.trim().toLowerCase();
  switch (base) {
    case "audio/mp4":
    case "audio/x-m4a":
      return "m4a";
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/ogg":
      return "ogg";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/aac":
      return "aac";
    default:
      return "webm";
  }
}

/** "0:08" — a duration a person reads, not 8200. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
