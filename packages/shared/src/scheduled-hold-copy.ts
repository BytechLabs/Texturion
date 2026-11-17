import type { Locale } from "./locale";

type OutboundHoldReason =
  | "usage_cap_reached"
  | "rate_limited"
  | "quiet_hours"
  | "opt_out_unresolved";

export const OUTBOUND_HOLD_COPY = {
  en: {
    usage_cap_reached: "The workspace spending cap has been reached.",
    rate_limited: "The workspace has reached its hourly texting limit.",
    quiet_hours: "This text is waiting until the customer's quiet hours end.",
    opt_out_unresolved: "Review the customer's opt-out request before this text can send.",
  },
  "fr-CA": {
    usage_cap_reached: "Le plafond de dépenses de l’espace a été atteint.",
    rate_limited: "L’espace a atteint sa limite horaire de textos.",
    quiet_hours: "Ce texto attend la fin des heures de tranquillité du client.",
    opt_out_unresolved: "Examinez la demande de désabonnement du client avant l’envoi de ce texto.",
  },
} as const satisfies Record<Locale, Record<OutboundHoldReason, string>>;
