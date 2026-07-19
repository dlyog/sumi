import { expect, test } from "@playwright/test";


test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-learn").click();
});


test("each course shows only its own four lessons", async ({ page }) => {
  await page.getByTestId("course-card-hardware-evidence").click();

  const tabs = page.getByTestId("course-lesson-tabs");
  await expect(tabs.getByRole("button")).toHaveCount(4);
  await expect(tabs).toContainText("Gate model, annealing, and simulation");
  await expect(tabs).toContainText("Qubit hardware modalities");
  await expect(tabs).toContainText("Compilation and QPU fit");
  await expect(tabs).toContainText("Benchmarks, QBI, and claims");
  await expect(tabs).not.toContainText("Bits and qubits");

  await tabs.getByRole("button", { name: /Compilation and QPU fit/ }).click();
  await expect(page.getByTestId("course-lesson-title")).toHaveText("Compilation and QPU fit");

  await page.getByTestId("course-card-effects").click();
  await expect(tabs.getByRole("button")).toHaveCount(4);
  await expect(tabs).toContainText("Interference");
  await expect(tabs).toContainText("Error correction intuition");
  await expect(tabs).not.toContainText("Compilation and QPU fit");
});


test("the wide footer shares one left-aligned grid", async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 1000 });
  const footer = page.getByTestId("legal-footer");
  await footer.scrollIntoViewIfNeeded();

  const layout = await footer.evaluate((node) => {
    const brand = node.querySelector(".footer-brand")!.getBoundingClientRect();
    const links = node.querySelector(".footer-link-groups")!.getBoundingClientRect();
    const legal = node.querySelector(".footer-legal")!.getBoundingClientRect();
    const outer = node.getBoundingClientRect();
    return {
      height: outer.height,
      topDelta: Math.abs(brand.top - links.top),
      leftDelta: Math.abs(brand.left - legal.left),
      legalTextAlign: getComputedStyle(node.querySelector(".footer-legal")!).textAlign,
    };
  });

  expect(layout.height).toBeLessThanOrEqual(100);
  expect(layout.topDelta).toBeLessThanOrEqual(8);
  expect(layout.leftDelta).toBeLessThanOrEqual(2);
  expect(layout.legalTextAlign).toBe("left");
});
