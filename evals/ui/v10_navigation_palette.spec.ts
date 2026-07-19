import { test, expect } from "@playwright/test";


test("a normal page load starts in the Learn workspace", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("learning-view")).toBeVisible();
  await expect(page.getByTestId("nav-learn")).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#navCircuits")).not.toHaveClass(/active/);
  await expect(page.locator("#circuitPage")).toBeHidden();
});


test("the gate palette lives in Circuit Studio and inserts a real gate", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("learning-view")).toBeVisible();
  await expect(page.getByTestId("palette")).toBeHidden();

  await page.locator("#navCircuits").click();
  await expect(page.getByTestId("palette")).toBeVisible();
  await page.locator('.palette-item[data-op="RY"]').click();

  await expect(page.getByRole("heading", { name: "Algorithm studio" })).toBeVisible();
  await expect(page.locator("#navCircuits")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("learning-view")).toBeHidden();
  await expect(page.getByTestId("circuit-canvas")).toContainText("RY");
});


test("an explicit circuit workspace link opens Circuit Studio", async ({ page }) => {
  await page.goto("/?view=circuits");

  await expect(page.getByRole("heading", { name: "Algorithm studio" })).toBeVisible();
  await expect(page.locator("#navCircuits")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("learning-view")).toBeHidden();
});
