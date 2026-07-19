import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    });
    class Recorder {
      state = "inactive";
      mimeType = "audio/webm";
      onstop: (() => void) | null = null;
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; this.onstop?.(); }
    }
    class AudioContextStub {
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createAnalyser() { return { fftSize: 0, disconnect() {}, getByteTimeDomainData(values: Uint8Array) { values.fill(128); } }; }
      async close() {}
    }
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: Recorder });
    Object.defineProperty(window, "AudioContext", { configurable: true, value: AudioContextStub });
    HTMLMediaElement.prototype.play = async function () {};
  });
});

test("Sumi exposes a reusable screen registry and visible latest turn", async ({ page }) => {
  await page.goto("/?view=circuits");

  const registry = await page.request.get("/sumi-screen-registry.json");
  expect(registry.ok()).toBe(true);
  const payload = await registry.json();
  expect(payload.actions.map((entry: { id: string }) => entry.id)).toContain("stop_conversation");
  expect(payload.terms.map((entry: { id: string }) => entry.id)).toContain("bloch_sphere");

  await expect(page.getByTestId("co-teacher-turn")).toBeHidden();
  await page.getByTestId("companion-open-header").click();
  await expect(page.getByTestId("co-teacher-turn")).toBeVisible();
  await expect(page.getByTestId("co-teacher-sumi-turn")).toContainText("Sumi");
});

test("Sumi latest turn does not overflow compact screens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=circuits");
  await page.getByTestId("companion-open-header").click();

  const geometry = await page.getByTestId("co-teacher-turn").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewport: document.documentElement.clientWidth };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
});

test("Sumi AI Teaching Assistant is available across every main menu workspace", async ({ page }) => {
  const workspaces = ["learn", "improve", "use-cases", "drug", "providers", "benchmarking", "podcast", "community"];
  for (const workspace of workspaces) {
    await page.goto(`/?view=${workspace}`);
    const sumi = page.getByTestId("faq-assistant-open");
    await expect(sumi).toBeVisible();
    await expect(sumi).toHaveAttribute("aria-label", /AI Teaching Assistant/);
    await sumi.click();
    await expect(page.getByTestId("faq-assistant")).toContainText("Talk with Sumi");
  }

  await page.goto("/?view=circuits");
  await expect(page.getByTestId("faq-assistant-open")).toBeHidden();
  await expect(page.getByTestId("companion-open-header")).toBeVisible();
  await expect(page.getByTestId("companion-open-header")).toHaveAttribute("aria-label", /Sumi AI Teaching Assistant/);
});
