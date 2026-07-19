import { expect, test } from "@playwright/test";


test("documented RX sample runs without retaining an LLM validation error", async ({ page }) => {
  await page.goto("/?view=circuits");
  await page.locator("#samplePromptSelect").selectOption({ label: "RX rotation by 90 degrees" });
  await page.locator("#backendSelect").selectOption("cirq");
  await page.getByTestId("nl-run").click();

  await expect(page.locator("#nlError")).toBeHidden();
  await expect(page.getByTestId("interpretation-echo")).toContainText(/Built: 1 qubit.*RX\(1\.571\).*measure/i);
  await expect(page.getByTestId("circuit-canvas")).toContainText("RX");
});


test("workspace navigation resets Benchmark to its visible header", async ({ page }) => {
  await page.goto("/?view=drug");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  await page.getByTestId("nav-benchmarking").click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(1);
  await expect(page.getByRole("heading", { name: "1StopQuantum intelligence" })).toBeVisible();
  await expect(page.getByTestId("benchmark-tab-landscape")).toBeInViewport();
});


test("navigation, account actions, and gate comparison follow the learning hierarchy", async ({ page }) => {
  await page.goto("/");

  const order = await page.locator(".primary-nav .nav-item").evaluateAll((items) => items.map((item) => item.id));
  expect(order.indexOf("navImprove")).toBe(order.indexOf("navCircuits") + 1);
  await expect(page.locator(".sidebar .account-panel")).toHaveCount(0);
  await expect(page.locator(".app-utility-bar #accountLogout")).toBeVisible();
  await expect(page.getByTestId("account-status")).toContainText(/Scholar/i);

  const table = page.getByTestId("gate-comparison-table");
  await expect(table).toBeVisible();
  for (const gate of ["AND", "OR", "NOT", "XOR"]) {
    await expect(table.getByRole("row", { name: new RegExp(`^${gate}\\b`, "i") })).toBeVisible();
  }
  await expect(table).toContainText(/Pauli X/i);
  await expect(table).toContainText(/CNOT/i);
  await expect(page.locator(".gate-logic-comparison")).toContainText(/reversible.*measurement/is);
});
