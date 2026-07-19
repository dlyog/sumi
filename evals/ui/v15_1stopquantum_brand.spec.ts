import { expect, test } from "@playwright/test";

test("the supplied 1StopQuantum identity is local and consistent", async ({ page, request }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("1StopQuantum");
  const logo = page.getByTestId("brand-logo");
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute("src", "/assets/1stopquantum-logo.png");
  await expect(page.locator(".sidebar")).not.toContainText("QuantumYog");

  const asset = await request.get("/assets/1stopquantum-logo.png");
  expect(asset.ok()).toBeTruthy();
  expect(asset.headers()["content-type"]).toContain("image/png");

  await page.getByTestId("nav-guide").click();
  await expect(page.getByRole("heading", { name: "1StopQuantum Documentation" })).toBeVisible();
  await expect(page.getByTestId("docs-brand-logo")).toHaveAttribute("src", "/assets/1stopquantum-logo.png");

  const manifest = await request.get("/manifest.webmanifest");
  expect((await manifest.json()).name).toBe("1StopQuantum");
});

test("the wide logo remains readable without overflowing tablet and phone rails", async ({ page }) => {
  for (const viewport of [{ width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const geometry = await page.getByTestId("brand-logo").evaluate((node) => {
      const image = node as HTMLImageElement;
      const rect = image.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(geometry.naturalWidth).toBe(1310);
    expect(geometry.naturalHeight).toBe(610);
    expect(geometry.width).toBeGreaterThanOrEqual(viewport.width < 500 ? 38 : 170);
    expect(geometry.height).toBeGreaterThanOrEqual(30);
    expect(geometry.overflow).toBeLessThanOrEqual(1);
  }
});
