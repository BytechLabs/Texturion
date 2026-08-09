import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { JobPhotoPage } from "./job-photo-page";

/**
 * #294 — the page a homeowner opens, under their contractor's name.
 *
 * The first page in this product opened by a customer's customer. What these pin is
 * mostly what it must NOT do: name us, tell a link-guesser why a link failed, or
 * invent a heading for photos nobody labelled.
 */

function photo(id: string, phase: "before" | "after" | null = null) {
  return { id, work_phase: phase, url: `https://bucket.example/${id}.jpg?token=x` };
}

describe("the shared job photos (#294)", () => {
  it("appears under the business's name, and never ours", () => {
    // D75: for many homeowners this is the only thing they will ever see of this
    // product, and it is there to make the business that hired us look competent.
    const html = renderToStaticMarkup(
      <JobPhotoPage businessName="Acme Plumbing" photos={[photo("a")]} />,
    );
    expect(html).toContain("Acme Plumbing");
    expect(html).not.toContain("Loonext");
  });

  it("separates the before from the after, which is what they came to see", () => {
    const html = renderToStaticMarkup(
      <JobPhotoPage
        businessName="Acme"
        photos={[photo("a", "before"), photo("b", "after")]}
      />,
    );
    expect(html).toContain("Before");
    expect(html).toContain("After");
    expect(html.indexOf("Before")).toBeLessThan(html.indexOf("After"));
  });

  it("shows unlabelled photos without inventing a heading for them", () => {
    // Most jobs will have some. Filing them under "Before" would be a claim about
    // the work that nobody made.
    const html = renderToStaticMarkup(
      <JobPhotoPage businessName="Acme" photos={[photo("a"), photo("b")]} />,
    );
    expect(html).toContain("bucket.example/a.jpg");
    expect(html).not.toContain("Before");
    expect(html).not.toContain("After");
  });

  it("says so plainly when there are no photos yet", () => {
    const html = renderToStaticMarkup(<JobPhotoPage businessName="Acme" photos={[]} />);
    expect(html).toContain("no photos on this job yet");
  });

  it("gives one reason for every kind of dead link, and a next step", () => {
    // THE CASE THAT MATTERS. Expired, revoked, wrong token, never existed: a
    // customer cannot act on the difference, and somebody guessing URLs would be
    // handed an oracle by it (D75).
    const html = renderToStaticMarkup(<JobPhotoPage notAvailable />);
    expect(html).toContain("isn&#x27;t available");
    expect(html).toContain("Ask whoever sent it");
    for (const leak of ["expired link", "revoked", "not found", "invalid token"]) {
      expect(html.toLowerCase(), leak).not.toContain(leak);
    }
  });

  it("#581/9: says so when the job had more photos than fit", () => {
    // A silent cap would turn "here is everything we did" into a claim we are not
    // keeping, and neither the customer nor the crew who sent the link would know.
    const html = renderToStaticMarkup(
      <JobPhotoPage
        businessName="Acme"
        photos={[photo("a", "after"), photo("b", "before")]}
        truncated
      />,
    );
    expect(html).toContain("more photos than fit");
    expect(html).toContain("the first 2");
    expect(html).toContain("Ask Acme");
  });

  it("#581/9: and says nothing of the sort for an ordinary job", () => {
    const html = renderToStaticMarkup(
      <JobPhotoPage businessName="Acme" photos={[photo("a", "after")]} />,
    );
    expect(html).not.toContain("more photos than fit");
  });

  it("carries no alt text it made up about somebody's work", () => {
    // A generated description of a photograph nobody has read would be a claim
    // about the job. Empty alt is the honest answer for a decorative-position
    // image whose content we cannot describe.
    const html = renderToStaticMarkup(
      <JobPhotoPage businessName="Acme" photos={[photo("a", "after")]} />,
    );
    expect(html).toContain('alt=""');
  });
});
