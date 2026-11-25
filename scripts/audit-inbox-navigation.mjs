const THREADS = [
  { id: "b0000000-0000-4000-8000-000000000001", name: "Maria Alvarez" },
  { id: "b0000000-0000-4000-8000-000000000005", name: "Priya Natarajan" },
];
const TASK_ID = "e0000000-0000-4000-8000-000000000001";
const SEARCH_TERM = "water heater";

export async function auditInboxNavigation(page, base) {
  await page.goto(`${base}/inbox?status=open`, { waitUntil: "networkidle" });
  const status = page.getByRole("combobox", { name: "Conversation status" });
  const open = status.and(page.locator('[data-value="open"]'));

  for (const { id, name } of THREADS) {
    const path = `/inbox/${id}`;
    const row = page.getByRole("link", { name }).and(page.locator(`a[href^="${path}"]`));
    await row.press("Enter");
    await page.waitForURL((url) => url.pathname === path && url.searchParams.get("status") === "open");
    await page.getByRole("heading", { level: 1, name }).and(page.locator(":focus")).waitFor();
    await page.waitForFunction((title) => document.title.endsWith(title), `${name} · Loonext`);
    await page.goBack();
    await page.waitForURL((url) => url.pathname === "/inbox" && url.searchParams.get("status") === "open");
    await row.and(page.locator(":focus")).waitFor();
  }
  console.log("theme-audit: two inbox threads have distinct titles and restore keyboard focus");

  for (const id of [THREADS[0].id, THREADS[1].id, THREADS[0].id]) {
    const path = `/inbox/${id}`;
    await page.locator(`a[href^="${path}"]:visible`).first().click();
    await page.waitForURL((url) => url.pathname === path && url.searchParams.get("status") === "open");
    await open.waitFor();
  }

  const taskThread = `/inbox/${THREADS[0].id}`;
  await page.goto(
    `${base}${taskThread}?status=open&task=${TASK_ID}`,
    { waitUntil: "networkidle" },
  );
  await status.click();
  await page.getByRole("option", { name: "All", exact: true }).click();
  await page.waitForURL((url) =>
    url.pathname === taskThread && !url.searchParams.has("status") && url.searchParams.get("task") === TASK_ID,
  );

  await page.goto(`${base}/inbox`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Search conversations and contacts" }).click();
  await page.locator("[data-inbox-search]").fill(SEARCH_TERM);
  const matches = page.getByRole("region", { name: "Matching conversations" });
  const result = matches.locator(`a[href^="/inbox/${THREADS[0].id}"]`);
  await result.press("Enter");
  await page.waitForURL((url) =>
    url.pathname === `/inbox/${THREADS[0].id}` && url.searchParams.get("q") === SEARCH_TERM,
  );
  await page.getByRole("heading", { level: 1, name: THREADS[0].name }).and(page.locator(":focus")).waitFor();
  await page.goBack();
  await page.waitForURL((url) => url.pathname === "/inbox" && url.searchParams.get("q") === SEARCH_TERM);
  await result.and(page.locator(":focus")).waitFor();
  await result.click();
  await page.waitForURL((url) =>
    url.pathname === `/inbox/${THREADS[0].id}` && url.searchParams.get("q") === SEARCH_TERM,
  );
  await result.waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "Back to inbox" }).click();
  await page.waitForURL((url) => url.pathname === "/inbox" && url.searchParams.get("q") === SEARCH_TERM);
  await result.waitFor();
  console.log("theme-audit: inbox filters and task target survive navigation, and search restores focus");
}
