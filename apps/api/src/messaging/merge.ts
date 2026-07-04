/**
 * Server-side canonical merge-field application for the send path
 * (FEATURE-GAPS Step 0a). Applied at SEND time to composed messages, saved
 * replies pasted into the composer, the away-reply, and the review ask — all of
 * them — so {first_name}/{business_name}/{review_link} resolve from the SAME
 * canonical substituter the web composer previews with (@jobtext/shared).
 *
 * It reuses the contact + company already loaded on the send path (no extra
 * query per send): callers pass the fields they already hold. Unknown/empty
 * tokens degrade gracefully (the token is dropped cleanly — never a literal
 * `{first_name}` on the wire) — that logic lives in @jobtext/shared.
 */
import { applyMergeFields } from "@jobtext/shared";

/** The already-loaded contact + company slice a merge needs. */
export interface MergeContext {
  contactName?: string | null;
  businessName?: string | null;
  reviewLink?: string | null;
}

/**
 * Substitute merge fields in `body` using data already on the send path. Pure;
 * no I/O. Returns `body` unchanged when it carries no tokens.
 */
export function applySendMergeFields(body: string, ctx: MergeContext): string {
  return applyMergeFields(body, {
    contactName: ctx.contactName ?? null,
    businessName: ctx.businessName ?? null,
    reviewLink: ctx.reviewLink ?? null,
  });
}
