/** Vendor names are proper nouns; every reader-facing description is a key. */
export const SUBPROCESSORS = [
  {
    name: "Telnyx",
    purpose: "telnyxPurpose",
    data: "telnyxData",
    region: "telnyxRegion",
  },
  {
    name: "Stripe",
    purpose: "stripePurpose",
    data: "stripeData",
    region: "stripeRegion",
  },
  {
    name: "Supabase",
    purpose: "supabasePurpose",
    data: "supabaseData",
    region: "supabaseRegion",
  },
  {
    name: "Cloudflare",
    note: "cloudflareNote",
    purpose: "cloudflarePurpose",
    data: "cloudflareData",
    region: "cloudflareRegion",
  },
  {
    name: "Resend",
    purpose: "resendPurpose",
    data: "resendData",
    region: "resendRegion",
  },
  {
    name: "Google (Firebase Cloud Messaging)",
    purpose: "firebasePurpose",
    data: "firebaseData",
    region: "firebaseRegion",
  },
  {
    name: "PostHog",
    purpose: "posthogPurpose",
    data: "posthogData",
    region: "posthogRegion",
  },
] as const;
