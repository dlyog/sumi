import { expect, test } from "@playwright/test";

test("documentation outline follows the selected article", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-guide").click();
  await page.getByRole("button", { name: "Benchmark intelligence" }).click();

  const outline = page.locator(".docs-toc");
  await expect(outline).toContainText("QPU Match");
  await expect(outline).toContainText("Forecasting");
  await expect(outline).toContainText("Claims + QBI");
  await expect(outline).not.toContainText("First circuit");

  await outline.getByRole("link", { name: "Claims + QBI" }).click();
  await expect(page.locator("#claims-qbi")).toBeInViewport();
});
