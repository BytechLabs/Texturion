/**
 * #294 — a job's photos, shared with the customer who paid for the work.
 *
 * ## Why a page rather than a text
 *
 * This issue names a constraint nobody had written down: the best job
 * documentation is structurally internal-only. A full-resolution photo of a serial
 * plate or a hairline crack has to travel as a NOTE (25 MB), because a text is
 * capped at 1 MB per image and three images per message by the carriers. So the
 * pictures worth keeping are exactly the ones a customer could never receive, and
 * "here is everything we did" over MMS means picking three of them and hoping the
 * compression leaves something readable.
 *
 * A page fixes that by not being a text: it serves the note-quality set, in the
 * order the work happened, with the before and after already labelled.
 *
 * ## The first consumer of D75, and it stays inside it
 *
 * `public_links` was built by #335 and used by nothing. Everything here is that
 * primitive: 256-bit token, hash-only storage, purpose checked rather than
 * inferred, expiry required, one failure response for every failure, fails closed.
 * The only decisions this file makes are the ones D75 left to the feature — how
 * long, and what the page may show.
 *
 * ## What the page may show, and the reasoning
 *
 * The photos, their labels, their times, and the business's name. NOT the
 * customer's name, address, or phone; NOT the crew member's name; NOT the note
 * bodies. The customer already knows their own address, so putting it on the page
 * adds risk without adding anything — and this is a URL that lives in SMS logs and
 * browser history. The crew's names are withheld for the same reason a homeowner
 * does not need the roster of the company they hired.
 *
 * Note BODIES are the sharpest exclusion. A note is where a tech writes "customer
 * seems confused about what she already paid for" — internal by construction. The
 * photos are the record being shared; the commentary around them is not.
 */
import { Hono } from "hono";
import { z } from "zod";

import { assertEgressWithinAllowance } from "../attachments/egress";
import { recordAuditFromRequest } from "../audit/log";
import { requireCapability } from "../auth/company";
import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { dispositionOptions } from "../storage/disposition";
import { ApiError, errorResponse } from "../http/errors";
import {
  callerCountry,
  publicLinkGuard,
  publicLinkNotAvailable,
} from "../public-links/guard";
import {
  mintPublicLink,
  resolvePublicLink,
  revokeLinksForSubject,
} from "../public-links/tokens";
import { parseOptionalJsonBody, pathUuid } from "./core/http";

/** Authenticated: the crew mints and revokes. Mounted under /v1. */
export const jobPhotoShareRoutes = new Hono<AppEnv>();

/** Unauthenticated: the customer opens. Mounted at the root, outside /v1. */
export const publicJobPhotoRoutes = new Hono<AppEnv>();

/**
 * Thirty days.
 *
 * D75 requires an expiry and leaves the number to the feature. Thirty days is long
 * enough that a link texted on Friday still opens when somebody gets to it, and
 * short enough that a record of the inside of a house does not sit on the public
 * internet for a year. A customer who needs it later can be sent another; a link
 * nobody can revoke because everybody forgot about it is the failure D75 exists to
 * prevent.
 */
const SHARE_DAYS = 30;

const shareSchema = z.object({
  /** Reserved for a future "expires sooner" control; absent means the default. */
  days: z.number().int().min(1).max(SHARE_DAYS).optional(),
});

/**
 * POST /v1/tasks/:id/photos/share — mint a link to this job's photos.
 *
 * `history.read` rather than an owner capability: this shares work the crew did,
 * and the person who did it is the one standing in front of the customer saying
 * "I'll send you the pictures". Gating it on the owner would mean the photos get
 * texted from a personal phone instead, which is the behaviour this product exists
 * to replace.
 */
jobPhotoShareRoutes.post(
  "/tasks/:id/photos/share",
  requireCapability("history.read"),
  async (c) => {
    const taskId = pathUuid(c, "id");
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));
    const body = await parseOptionalJsonBody(c, shareSchema);

    // The task must be this workspace's and still live. Checked before minting so
    // a token can never outlive the thing it points at.
    const { data, error } = await db
      .from("tasks")
      .select("id")
      .eq("id", taskId)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .limit(1);
    if (error) throw new Error(`task lookup failed: ${error.message}`);
    if ((data ?? []).length === 0) {
      return errorResponse(c, "not_found", "No such job.");
    }

    // Replace rather than accumulate. Two live links to the same photos is two
    // things to remember to revoke, and the crew asking again means the first one
    // did not reach anybody.
    await revokeLinksForSubject(
      db,
      companyId,
      "task_photos",
      taskId,
      "replaced by a new link",
    );

    const expiresAt = new Date(Date.now() + (body.days ?? SHARE_DAYS) * 86_400_000);
    const link = await mintPublicLink(db, {
      companyId,
      purpose: "photo_set",
      subjectType: "task_photos",
      subjectId: taskId,
      expiresAt,
      actorUserId: c.get("userId"),
    });

    await recordAuditFromRequest(db, c, {
      companyId,
      action: "job_photos.shared",
      targetType: "task",
      targetId: taskId,
      after: { expires_at: expiresAt.toISOString() },
    });

    return c.json({
      // The ONLY time the plaintext exists outside the customer's hands.
      url: `${getEnv(c.env).APP_ORIGIN}/photos/${link.token}`,
      expires_at: expiresAt.toISOString(),
    });
  },
);

/** DELETE /v1/tasks/:id/photos/share — the customer should not have it any more. */
jobPhotoShareRoutes.delete(
  "/tasks/:id/photos/share",
  requireCapability("history.read"),
  async (c) => {
    const taskId = pathUuid(c, "id");
    const companyId = c.get("companyId");
    const db = getDb(getEnv(c.env));

    // #571: the task must be this workspace's — the same check the POST above
    // makes before minting, which this had no counterpart to. Without it a
    // `read_only` or `member` acting from a workspace they own could kill another
    // workspace's live customer link, and the only audit row landed in theirs.
    //
    // Kept here as well as in the RPC on purpose: the RPC makes it unbypassable,
    // this makes the answer honest. Without it a foreign id returns `{revoked: 0}`
    // — a 200 saying nothing happened, which is indistinguishable from a link that
    // had already expired.
    const { data: task, error: taskError } = await db
      .from("tasks")
      .select("id")
      .eq("id", taskId)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .limit(1);
    if (taskError) throw new Error(`task lookup failed: ${taskError.message}`);
    if ((task ?? []).length === 0) {
      return errorResponse(c, "not_found", "No such job.");
    }

    const revoked = await revokeLinksForSubject(
      db,
      companyId,
      "task_photos",
      taskId,
      "the crew withdrew it",
    );

    await recordAuditFromRequest(db, c, {
      companyId,
      action: "job_photos.share_revoked",
      targetType: "task",
      targetId: taskId,
      after: { links_revoked: revoked },
    });

    return c.json({ revoked });
  },
);

/** One photo on the shared page. Deliberately narrower than the crew's view. */
interface SharedPhoto {
  id: string;
  work_phase: "before" | "after" | null;
  taken_at: string;
  url: string;
}

/**
 * How many photos one page may carry, and why there is a number at all.
 *
 * There was none. Every note on the job was read, every image on every note was
 * signed, and each signature was its own round trip in a sequential loop — so a
 * long remodel with a few hundred progress photos meant a few hundred round trips
 * inside one request on a Worker, and a few hundred full-size objects becoming
 * downloadable at once.
 *
 * 200 is above any job we have seen and still a bound. Hitting it does not silently
 * shorten the record: the page is told, and says so, because a customer looking at
 * "everything we did" needs to know when it is not everything.
 */
const MAX_SHARED_PHOTOS = 200;

/**
 * How many notes to read looking for those photos.
 *
 * Notes outnumber photos — most carry none — so this is the wider bound of the two.
 */
const MAX_SHARED_NOTES = 500;

/** How long a customer's browser may keep using a URL from this page. */
const SHARED_PHOTO_TTL_SECONDS = 60 * 60;

/**
 * GET /photos/:token — what the customer's browser asks for.
 *
 * Outside /v1 and therefore outside every gate that protects it, which is why the
 * guard is mounted here rather than assumed.
 */
publicJobPhotoRoutes.get("/photos/:token", publicLinkGuard(), async (c) => {
  const db = getDb(getEnv(c.env));
  const resolved = await resolvePublicLink(
    db,
    c.req.param("token"),
    "photo_set",
    callerCountry(c),
  );
  // Every failure looks like this one. See D75: a holder who can tell "expired"
  // from "never existed" has been handed an oracle.
  if (!resolved.ok || !resolved.subject_id || !resolved.company_id) {
    return publicLinkNotAvailable(c);
  }

  const { data: company, error: companyError } = await db
    .from("companies")
    .select("name,locale")
    .eq("id", resolved.company_id)
    .maybeSingle();
  if (companyError) throw new Error(`company lookup failed: ${companyError.message}`);

  let loaded: { photos: SharedPhoto[]; truncated: boolean };
  try {
    loaded = await loadSharedPhotos(db, resolved.company_id, resolved.subject_id);
  } catch (cause) {
    /**
     * THE EGRESS DECISION, and it is a decision rather than an oversight.
     *
     * The bytes have to be metered. A public token is the least protected thing we
     * hand out — no account behind it, and whoever holds it can loop — so leaving
     * this page off the meter would make it the free side door around the download
     * cap that every authenticated mint path is careful not to be.
     *
     * But the refusal must never reach the homeowner AS A REFUSAL. Its copy names
     * the business's plan allowance and says it is used up, which is the business's
     * private billing state being read by a customer; and a second, distinguishable
     * answer is precisely the oracle D75 forbids — "this link is real and that
     * company is over its cap" is a fact a stranger with a guessed token should
     * never be able to learn.
     *
     * So the claim happens, the cap bites, and the answer is the one answer this
     * page has for everything. Downloads have genuinely stopped for that workspace;
     * this is one more place they have stopped. The crew see the honest 402 on
     * their own screens, where it names a plan they can do something about.
     *
     * Only the cap is caught. A real accounting failure still throws, because
     * nothing may be signed when the ledger cannot be trusted — and unlike the cap,
     * it is not correlated with anything a prober could farm.
     */
    if (cause instanceof ApiError && cause.code === "usage_cap_reached") {
      return publicLinkNotAvailable(c);
    }
    throw cause;
  }

  return c.json({
    // The page appears under the BUSINESS's name, not ours. It is the only thing
    // many homeowners will ever see of this product.
    business_name: (company as { name?: string } | null)?.name ?? "Your contractor",
    /**
     * #228: the language the BUSINESS works in — the one this page is drawn in.
     *
     * Not the reader's device and not ours. The person opening this has a
     * relationship with the tradesperson, not with us, so it is the business's
     * own choice that decides. A Quebec crew's customer meeting an English page
     * is the Bill 96 problem in miniature.
     */
    locale: (company as { locale?: string | null } | null)?.locale ?? "en",
    photos: loaded.photos,
    // Said out loud rather than quietly dropping the rest. Somebody looking at
    // "everything we did" has to know when it is not everything.
    truncated: loaded.truncated,
  });
});

/**
 * The images only, and only the ones on notes.
 *
 * IMAGES rather than every attachment: a customer receiving the crew's PDF quote
 * or a supplier invoice because it happened to be filed against the same job is a
 * leak, and nothing about "here are the photos" suggests it would happen.
 *
 * Notes only, which also excludes what the customer themselves texted. Sending
 * somebody their own photograph back adds nothing and doubles what the link
 * discloses if it leaks.
 */
async function loadSharedPhotos(
  db: ReturnType<typeof getDb>,
  companyId: string,
  taskId: string,
): Promise<{ photos: SharedPhoto[]; truncated: boolean }> {
  const { data: noteRows, error: noteError } = await db
    .from("messages")
    .select("id,work_phase,created_at")
    .eq("company_id", companyId)
    .eq("direction", "note")
    .eq("task_id", taskId)
    // Oldest first, so the bound below keeps the job in the order it happened
    // rather than an arbitrary slice of it.
    .order("created_at", { ascending: true })
    .limit(MAX_SHARED_NOTES);
  if (noteError) throw new Error(`note lookup failed: ${noteError.message}`);
  const notes = (noteRows ?? []) as {
    id: string;
    work_phase: "before" | "after" | null;
    created_at: string;
  }[];
  if (notes.length === 0) return { photos: [], truncated: false };

  const byNote = new Map(notes.map((note) => [note.id, note]));
  const { data: fileRows, error: fileError } = await db
    .from("attachments")
    .select(
      "id,owner_id,content_type,storage_path,preview_path,preview_bytes,size_bytes,created_at",
    )
    .eq("company_id", companyId)
    .eq("owner_type", "note")
    .in("owner_id", [...byNote.keys()])
    .is("deleted_at", null)
    // NOT QUARANTINED. A file the scanner pulled stops being downloadable for the
    // crew at the mint (#317), and this page mints too — it was simply never told.
    // Of everywhere in the product to hand somebody a file we have decided is
    // dangerous, a link texted to a member of the public is the worst, and they have
    // no relationship with us to explain it afterwards. Filtered in the query rather
    // than skipped in the loop so the row cannot reach the signing code at all.
    .is("quarantined_at", null)
    .order("created_at", { ascending: true })
    // One more than the page will show, purely to learn whether there were more.
    .limit(MAX_SHARED_PHOTOS + 1);
  if (fileError) throw new Error(`attachment lookup failed: ${fileError.message}`);

  interface FileRow {
    id: string;
    owner_id: string;
    content_type: string | null;
    storage_path: string;
    preview_path: string | null;
    preview_bytes: number | null;
    size_bytes: number | null;
    created_at: string;
  }
  const images = ((fileRows ?? []) as FileRow[]).filter(
    (row) =>
      (row.content_type ?? "").toLowerCase().startsWith("image/") &&
      byNote.has(row.owner_id),
  );
  const truncated = images.length > MAX_SHARED_PHOTOS;
  const page = images.slice(0, MAX_SHARED_PHOTOS);
  if (page.length === 0) return { photos: [], truncated: false };

  /**
   * The PREVIEW where there is one (#240), for two reasons that point the same way.
   *
   * A note carries up to 25 MB an image, because the whole premise of #294 is that
   * the photos worth keeping are the ones too big to text. This page is opened on a
   * phone, over mobile data, by somebody who wants to look at them — serving the
   * originals meant a homeowner downloading a couple of hundred megabytes to see
   * their kitchen, and it meant the same couple of hundred megabytes coming out of
   * the business's download allowance every time the link was opened.
   *
   * A row with no preview still serves its original, exactly as before: nothing
   * uploaded before derivatives existed stops working.
   */
  const served = page.map((row) => {
    const usePreview = row.preview_path !== null && row.preview_path !== undefined;
    return {
      row,
      path: usePreview ? (row.preview_path as string) : row.storage_path,
      // Charge what actually leaves. Claiming the original's size for a 200 KB
      // preview spends an allowance on bytes nobody downloaded.
      bytes: usePreview ? row.preview_bytes : row.size_bytes,
    };
  });

  // ONE claim for the page, before anything is signed — the gallery's shape, and
  // the reason it exists there applies twice over here. Over the allowance this
  // throws, and the route turns that into the same answer it gives a bad token.
  await assertEgressWithinAllowance(
    db,
    companyId,
    served.map((entry) => ({
      bucket: "attachments",
      path: entry.path,
      sizeBytes: entry.bytes,
    })),
    SHARED_PHOTO_TTL_SECONDS,
  );

  const photos: SharedPhoto[] = [];
  for (const { row, path } of served) {
    // #317: the disposition travels with the mint rather than being a boolean
    // somebody has to remember to invert. Every one of these is an image by the
    // filter above, so it resolves to inline — which is the point, since the page
    // renders them rather than downloading them.
    const { data: signed } = await db.storage
      .from("attachments")
      .createSignedUrl(
        path,
        SHARED_PHOTO_TTL_SECONDS,
        dispositionOptions(row.content_type),
      );
    if (!signed?.signedUrl) continue;
    const note = byNote.get(row.owner_id);
    if (!note) continue;
    photos.push({
      id: row.id,
      work_phase: note.work_phase,
      // The NOTE's time, not the file's: a visit is when the tech was there, and
      // an upload that finished later did not happen later.
      taken_at: note.created_at,
      url: signed.signedUrl,
    });
  }

  // Chronological, like the crew's own view — what happened, in order.
  photos.sort((left, right) =>
    left.taken_at === right.taken_at
      ? left.id.localeCompare(right.id)
      : left.taken_at.localeCompare(right.taken_at),
  );
  return { photos, truncated };
}
