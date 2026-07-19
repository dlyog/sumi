import { test, expect } from "@playwright/test";


test("Quantum 101 is readable and touch-friendly on a tablet", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await page.getByTestId("nav-learn").click();
  await page.getByTestId("lesson-tab-foundations").click();
  await page.getByTestId("level-high-school").click();

  const measurements = await page.evaluate(() => {
    const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
    const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    return {
      explanationFont: Number.parseFloat(style('[data-testid="lesson-explanation"]').fontSize),
      comparisonFont: Number.parseFloat(style("#comparisonCopy").fontSize),
      tabHeight: box('[data-testid="lesson-tab-foundations"]').height,
      levelHeight: box('[data-testid="level-high-school"]').height,
      lessonWidth: box(".lesson-content").width,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(measurements.explanationFont).toBeGreaterThanOrEqual(16);
  expect(measurements.comparisonFont).toBeGreaterThanOrEqual(15);
  expect(measurements.tabHeight).toBeGreaterThanOrEqual(44);
  expect(measurements.levelHeight).toBeGreaterThanOrEqual(44);
  expect(measurements.lessonWidth).toBeGreaterThanOrEqual(700);
  expect(measurements.overflow).toBeLessThanOrEqual(1);
});


test("a beginner sees an animated prepare-transform-measure model", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-learn").click();
  await page.getByTestId("lesson-tab-foundations").click();
  const flow = page.getByTestId("beginner-flow");

  await expect(flow).toBeVisible();
  await expect(flow).toContainText("Start with what you know");
  await expect(flow).toContainText("One switch stores either 0 or 1");
  await expect(flow.getByTestId("concept-step-prepare")).toContainText(/prepare/i);
  await expect(flow.getByTestId("concept-step-transform")).toContainText(/transform/i);
  await expect(flow.getByTestId("concept-step-measure")).toContainText(/measure/i);
  await expect(flow.getByTestId("concept-observation")).toContainText(/one result.*0 or 1/i);

  const animationName = await flow.locator(".concept-pulse").first().evaluate((node) => getComputedStyle(node).animationName);
  expect(animationName).not.toBe("none");
});


test("the app exposes an update-safe progressive web app", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");

  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));

  const buildResponse = await request.get("/build-version.js");
  expect(buildResponse.headers()["cache-control"]).toContain("no-store");
  expect(await buildResponse.text()).toContain("QYOG_BUILD_ID");

  await page.evaluate(async () => (window as typeof window & { __quantumyogServiceWorkerReady?: Promise<unknown> }).__quantumyogServiceWorkerReady);
  await expect.poll(async () => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations())[0]?.active?.scriptURL || "")).not.toBe("");
  const workerUrl = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations())[0].active?.scriptURL || "");
  expect(workerUrl).toContain("service-worker.js?v=");
});
