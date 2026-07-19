import { expect, test } from "@playwright/test";


test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-learn").click();
});


test("Learn presents a navigable short-course curriculum with saved narration", async ({ page }) => {
  await expect(page.getByTestId("course-catalog")).toContainText("Quantum foundations");
  await expect(page.getByTestId("course-catalog")).toContainText("Hardware & evidence");
  await expect(page.getByTestId("lesson-audio-player")).toHaveAttribute("src", /audio\/course\/bits-and-qubits\.wav/);
  await page.getByTestId("lesson-audio-toggle").click();
  await expect.poll(() => page.getByTestId("lesson-audio-player").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0);
  await page.getByTestId("lesson-audio-toggle").click();

  await page.getByTestId("course-outline-toggle").click();
  const outline = page.getByTestId("course-outline");
  await expect(outline).toBeVisible();
  await expect(outline).toContainText("16 short lessons");
  await page.getByTestId("course-lesson-noise-and-decoherence").click();

  await expect(page.getByTestId("course-lesson-title")).toHaveText("Noise and decoherence");
  await expect(page.getByTestId("course-guide")).toContainText("Learning objectives");
  await expect(page.getByTestId("course-guide")).toContainText(/environment|coherence/i);
  await expect(page.getByTestId("lesson-media-image")).toHaveAttribute("alt", /noise|decoherence/i);
  await expect(page.getByTestId("lesson-audio-player")).toHaveAttribute("src", /noise-and-decoherence\.wav/);
});


test("the active PWA service worker preserves lesson audio range streaming", async ({ page }) => {
  await page.evaluate(async () => {
    await (window as typeof window & { __quantumyogServiceWorkerReady?: Promise<ServiceWorkerRegistration> }).__quantumyogServiceWorkerReady;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.getByTestId("lesson-audio-toggle").click();
  await expect.poll(() => page.getByTestId("lesson-audio-player").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0);
  await page.getByTestId("lesson-audio-toggle").click();
});


test("the global audio guide explains how to use every workspace", async ({ page }) => {
  await page.getByTestId("audio-guide-open").click();
  const dialog = page.getByTestId("audio-guide-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("audio-guide-title")).toContainText("Learn");
  await expect(page.getByTestId("audio-guide-howto")).toContainText(/course|lesson|prediction/i);
  await expect(page.getByTestId("audio-guide-player")).toHaveAttribute("src", /audio\/screens\/learn\.wav/);
  await page.getByTestId("audio-guide-close").click();

  await page.locator("#navCircuits").click();
  await page.getByTestId("audio-guide-open").click();
  await expect(page.getByTestId("audio-guide-title")).toContainText("Circuit");
  await expect(page.getByTestId("audio-guide-howto")).toContainText(/natural language|manifest|run/i);
  await expect(page.getByTestId("audio-guide-player")).toHaveAttribute("src", /audio\/screens\/editor\.wav/);
});


test("course media and audio controls remain usable on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("lesson-media")).toBeVisible();
  await expect(page.getByTestId("lesson-audio-toggle")).toBeVisible();

  const controls = await page.evaluate(() => {
    const ids = ["courseOutlineToggle", "lessonAudioToggle", "audioGuideOpen"];
    return ids.map((id) => {
      const rect = document.getElementById(id)!.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
  });
  expect(controls.every(({ width, height }) => width >= 44 && height >= 44)).toBeTruthy();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
