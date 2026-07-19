import { test, expect } from "@playwright/test";


test("uses 1StopQuantum consistently across the product UI", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("1StopQuantum");
  await expect(page.getByTestId("brand-logo")).toHaveAttribute("alt", "1StopQuantum");
  await expect(page.locator("body")).not.toContainText("QuantumLab");

  await page.getByTestId("nav-guide").click();
  await expect(page.getByRole("heading", { name: "1StopQuantum Documentation" })).toBeVisible();
  await expect(page.getByTestId("documentation-view")).not.toContainText("QuantumLab");
});
