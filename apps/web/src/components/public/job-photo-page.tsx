import { WORK_PHASE_LABELS, type WorkPhase } from "@loonext/shared";

/**
 * #294 — the job photo record, as the homeowner sees it.
 *
 * ## Evaluation
 *
 * This is the first page in the product opened by a customer's customer, and D75's
 * point stands: it appears under the BUSINESS's name, not ours. For many homeowners
 * it will be the only thing they ever see of this product, and its job is to make
 * the business that hired us look like it documents its work.
 *
 * ## What binds it
 *
 * *The Safety Principle* — conventional to the point of dull. Nothing to log into,
 * nothing to dismiss, no navigation. Somebody who tapped a link in a text message
 * from a plumber is not looking for an experience; a page that behaves unexpectedly
 * here reads as a scam, which is the one failure that matters.
 *
 * *Prioritize Intent* — the photos are the page. The heading is one line and the
 * labels are quiet; there is no branding of ours anywhere on it.
 *
 * *Chunking* — grouped under Before and After when those exist, which is the
 * distinction the customer actually came to see. Unlabelled photos appear in one
 * plain run rather than under a heading that names them something they are not.
 *
 * *Zen of Clarity* — no download button, no share button, no lightbox. The browser
 * already does all three, and every control added here is a control that has to keep
 * working on a five-year-old Android in a driveway.
 *
 * ## The failure state is the same page
 *
 * Expired, revoked, wrong token, never existed: one message, and it says what to do
 * next rather than what went wrong. The customer cannot act on the difference, and
 * telling them apart is an oracle for anybody guessing URLs (D75).
 */
export function JobPhotoPage({
  businessName,
  photos = [],
  truncated = false,
  notAvailable = false,
}: {
  businessName?: string;
  photos?: { id: string; work_phase: WorkPhase | null; url: string }[];
  /**
   * #581/9: the job had more photos than one page carries.
   *
   * Said out loud rather than quietly shortened. The page's whole promise is "here
   * is everything we did", and a silent cap turns that into a claim we are not
   * keeping — the customer would have no way to know the set was incomplete, and
   * neither would the crew who sent it.
   */
  truncated?: boolean;
  notAvailable?: boolean;
}) {
  if (notAvailable) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
        <h1 className="text-xl font-semibold tracking-tight">
          This link isn&apos;t available
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
          It may have expired. Ask whoever sent it for a new one.
        </p>
      </main>
    );
  }

  const before = photos.filter((photo) => photo.work_phase === "before");
  const after = photos.filter((photo) => photo.work_phase === "after");
  const rest = photos.filter((photo) => photo.work_phase === null);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 md:px-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">
          Photos from {businessName}
        </h1>
        <p className="text-[14px] text-muted-foreground">
          {photos.length === 0
            ? "There are no photos on this job yet."
            : "The work on your job, as it was photographed."}
        </p>
        {/* One plain sentence in the header rather than a banner: it qualifies what
            the line above just promised, and it is not a problem the reader has to
            do anything about. Whoever sent the link is the one who can send more. */}
        {truncated && (
          <p className="text-[14px] text-muted-foreground">
            This job has more photos than fit on one page — these are the first{" "}
            {photos.length}. Ask {businessName} if you need the rest.
          </p>
        )}
      </header>

      {/* Before and after are what somebody opened this to compare, so they are
          the only headings. A section renders nothing when it is empty. */}
      <PhotoSection title={WORK_PHASE_LABELS.before} photos={before} />
      <PhotoSection title={WORK_PHASE_LABELS.after} photos={after} />
      <PhotoSection title={null} photos={rest} />
    </main>
  );
}

function PhotoSection({
  title,
  photos,
}: {
  title: string | null;
  photos: { id: string; url: string }[];
}) {
  if (photos.length === 0) return null;
  return (
    <section className="mt-8">
      {title !== null && (
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {photos.map((photo) => (
          // A plain <img>: these are signed URLs on a bucket, one page, no
          // layout shift worth a loader. next/image would proxy a private URL
          // through our own optimiser for no benefit to anybody.
          //
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={photo.id}
            src={photo.url}
            // Empty rather than invented: a generated description of a
            // photograph nobody has read would be a claim about the work.
            alt=""
            loading="lazy"
            className="w-full rounded-lg border bg-muted object-cover"
          />
        ))}
      </div>
    </section>
  );
}
