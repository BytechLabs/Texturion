/**
 * [#340] Erase a non-customer's contact-form submissions.
 *
 *   node scripts/ops/erase-contact.mjs --email someone@example.com
 *   node scripts/ops/erase-contact.mjs --email someone@example.com --apply
 *
 * Somebody who filled in the marketing contact form and later asks us to
 * delete their data has **no account to delete**. Every erasure path we own
 * runs through a workspace, so until this existed the honest answer would have
 * been improvised at the moment it was least welcome.
 *
 * It does not need to be self-serve at our scale. It needs to exist, and to
 * report a COUNT — so the reply can say what was actually removed rather than
 * "it should be gone".
 *
 * Deliberately narrow: this erases contact-form submissions and nothing else.
 * If the person is also a customer, that is a different request with a
 * different path (#227), and conflating them would delete a workspace nobody
 * asked us to touch.
 */
import { fail, runScript, showRows } from "./lib.mjs";

await runScript("erase-contact", async ({ args, apply, db, script }) => {
  const email = typeof args.email === "string" ? args.email.trim() : "";
  if (!email || !email.includes("@")) {
    fail("--email <address> is required. This never runs against everybody.");
  }

  // Show what is there BEFORE removing it: an erasure request deserves an
  // answer about what we held, not just confirmation that we no longer do.
  const rows = await db.select(
    "contact_messages",
    "id,created_at,name,email,company",
    { email: `ilike.${email}` },
  );
  showRows(`Contact-form submissions from ${email}`, rows);

  if (rows.length === 0) {
    console.log("  Nothing to erase. That is the honest answer to give them.\n");
    return;
  }

  if (!apply) {
    console.log(`  ${rows.length} row(s) would be deleted. Re-run with --apply.\n`);
    return;
  }

  const deleted = await db.rpc("api_erase_contact_messages", { p_email: email });

  console.log(
    `  ${script}: erased ${deleted ?? 0} submission(s) from ${email}.\n` +
      `  Tell them the number. "It should be gone" is not an answer to an\n` +
      `  erasure request.\n`,
  );
});
