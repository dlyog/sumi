import { test, expect } from "@playwright/test";


test("One Stop Quantum opens an evidence-backed benchmark landscape", async ({ page }) => {
  await page.goto("/?view=benchmarking");

  await expect(page.getByTestId("benchmarking-view")).toBeVisible();
  await expect(page.getByRole("heading", { name: "1StopQuantum intelligence" })).toBeVisible();
  await expect(page.getByTestId("benchmark-attribution")).toContainText(/Metriq.*CC BY 4.0/i);
  await expect(page.getByTestId("benchmark-record-count")).toContainText(/22[0-9] measurements/i);
  await expect(page.getByTestId("landscape-chart")).toBeVisible();
  await expect(page.getByTestId("landscape-date")).toContainText("2026");

  const initialDate = await page.getByTestId("landscape-date").textContent();
  await page.getByTestId("landscape-play").click();
  await expect.poll(async () => page.getByTestId("landscape-date").textContent()).not.toBe(initialDate);
  await page.getByTestId("landscape-play").click();
});


test("QPU Match shows suitability and evidence as different scores", async ({ page }) => {
  await page.goto("/?view=benchmarking");
  await page.getByTestId("benchmark-tab-match").click();
  await page.getByTestId("qpu-qubits").fill("50");
  await page.getByTestId("qpu-depth").fill("60");
  await page.getByTestId("qpu-workload").selectOption("optimization");
  await page.getByTestId("qpu-match-run").click();

  const results = page.getByTestId("qpu-match-results");
  await expect(results).toContainText("Suitability");
  await expect(results).toContainText("Evidence coverage");
  await expect(results.locator("tbody tr").first()).toContainText(/qubits/i);
  await expect(page.getByTestId("qpu-match-warning")).toContainText(/not live availability/i);
});


test("forecast and QBI claim review disclose their limits", async ({ page }) => {
  await page.goto("/?view=benchmarking");
  await page.getByTestId("benchmark-tab-forecast").click();
  await page.getByTestId("forecast-run").click();
  await expect(page.getByTestId("forecast-chart")).toBeVisible();
  await expect(page.getByTestId("forecast-confidence")).toContainText(/low confidence/i);
  await expect(page.getByTestId("forecast-disclaimer")).toContainText(/exploratory/i);

  await page.getByTestId("benchmark-tab-claims").click();
  await page.getByTestId("claim-provider").fill("Example Quantum");
  await page.getByTestId("claim-text").fill("Utility-scale system by 2033");
  await page.getByTestId("claim-assess").click();
  await expect(page.getByTestId("claim-result")).toContainText(/Stage A/i);
  await expect(page.getByTestId("claim-result")).toContainText(/missing evidence/i);
  await expect(page.getByTestId("claim-disclaimer")).toContainText(/not a DARPA determination/i);
});


test("benchmarking workspace remains usable at tablet and phone widths", async ({ page }) => {
  for (const viewport of [{ width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/?view=benchmarking");
    await expect(page.getByTestId("benchmarking-view")).toBeVisible();
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tabHeight: document.querySelector<HTMLElement>("[data-testid='benchmark-tab-landscape']")!.getBoundingClientRect().height,
      bodyFont: Number.parseFloat(getComputedStyle(document.querySelector("[data-testid='benchmarking-view']")!).fontSize),
    }));
    expect(layout.overflow).toBeLessThanOrEqual(1);
    expect(layout.tabHeight).toBeGreaterThanOrEqual(42);
    expect(layout.bodyFont).toBeGreaterThanOrEqual(14);
  }
});
