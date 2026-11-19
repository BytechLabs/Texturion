const THREADS = [
  "b0000000-0000-4000-8000-000000000001",
  "b0000000-0000-4000-8000-000000000005",
];
const TASK_ID = "e0000000-0000-4000-8000-000000000001";
const SEARCH_TERM = "water heater";

export async function auditInboxNavigation(page, base) {
  await page.goto(`${base}/inbox?status=open`, { waitUntil: "networkidle" });
  const status = page.getByRole("radiogroup", { name: "Conversation status" });
  const open = status.getByRole("radio", { name: /^Open\b/, checked: true });
  for (const id of [THREADS[0], THREADS[1], THREADS[0]]) {
    const path = `/inbox/${id}`;
    await page.locator(`a[href^="${path}"]:visible`).first().click();
    await page.waitForURL((url) => url.pathname === path && url.searchParams.get("status") === "open");
    await open.waitFor();
  }

  const taskThread = `/inbox/${THREADS[0]}`;
  await page.goto(
    `${base}${taskThread}?status=open&task=${TASK_ID}`,
    { waitUntil: "networkidle" },
  );
  await status.getByRole("radio", { name: "All", exact: true }).click();
  await page.waitForURL((url) =>
    url.pathname === taskThread && !url.searchParams.has("status") && url.searchParams.get("task") === TASK_ID,
  );

  await page.goto(`${base}/inbox`, { waitUntil: "networkidle" });
  await page.locator("[data-inbox-search]").fill(SEARCH_TERM);
  const matches = page.getByRole("region", { name: "Matching conversations" });
  const result = matches.locator(`a[href^="/inbox/${THREADS[0]}"]`);
  await result.click();
  await page.waitForURL((url) =>
    url.pathname === `/inbox/${THREADS[0]}` && url.searchParams.get("q") === SEARCH_TERM,
  );
  await result.waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "Back to inbox" }).click();
  await page.waitForURL((url) => url.pathname === "/inbox" && url.searchParams.get("q") === SEARCH_TERM);
  await result.waitFor();
  console.log("theme-audit: inbox filters, task target and search survive navigation");
}
