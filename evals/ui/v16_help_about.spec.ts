import { expect, test } from "@playwright/test";

test("help is a global top-right utility instead of a workspace", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator(".primary-nav")).not.toContainText("Docs");
  const utilities = page.getByTestId("app-utilities");
  const help = page.getByTestId("nav-guide");
  await expect(utilities).toBeVisible();
  await expect(help).toHaveAttribute("aria-label", "Help and documentation");

  const placement = await utilities.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { right: rect.right, top: rect.top, viewport: window.innerWidth };
  });
  expect(placement.viewport - placement.right).toBeLessThanOrEqual(32);
  expect(placement.top).toBeLessThanOrEqual(4);

  await help.click();
  await expect(page.getByRole("heading", { name: "1StopQuantum Documentation" })).toBeVisible();
});

test("about dialog explains the version, purpose, and trust boundaries", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("about-open").click();

  const dialog = page.getByTestId("about-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "About 1StopQuantum" })).toBeVisible();
  await expect(dialog.locator(".about-meta")).toContainText("Version");
  await expect(dialog.locator(".about-meta")).toContainText("0.4.0");
  await expect(dialog).toContainText("Local-first");
  await expect(dialog).toContainText("Simulation only");
  await expect(dialog).toContainText("Metriq");
  await expect(dialog).toContainText("not a DARPA determination");
  await expect(dialog.locator("#aboutBuild")).not.toHaveText("");

  await page.getByTestId("about-close").click();
  await expect(dialog).not.toBeVisible();
});

test("help and about remain touch-friendly on phones", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  for (const testId of ["nav-guide", "about-open"]) {
    const size = await page.getByTestId(testId).evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height, right: rect.right };
    });
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
    expect(size.right).toBeLessThanOrEqual(390);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("documentation does not repeat the global product logo", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-guide").click();

  await expect(page.getByRole("heading", { name: "1StopQuantum Documentation" })).toBeVisible();
  await expect(page.getByTestId("docs-brand-logo")).toBeHidden();
  await expect(page.locator(".docs-header .docs-brand-logo-frame")).toHaveCount(0);
});
