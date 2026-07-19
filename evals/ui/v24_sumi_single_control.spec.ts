import { expect, test } from "@playwright/test";

test("Sumi uses one explicit duplex control with a temporary intro skip", async ({ page }) => {
  await page.addInitScript(() => {
    const track = { stopped: false, stop() { this.stopped = true; } };
    Object.assign(window, { __sumiActivationTrack: track, __sumiMediaConstraints: null });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        async getUserMedia(constraints: MediaStreamConstraints) {
          (window as any).__sumiMediaConstraints = constraints;
          return { getTracks: () => [track] };
        },
      },
    });
    class Recorder {
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; this.onstop?.(); }
    }
    class AudioContextStub {
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createAnalyser() {
        return {
          fftSize: 0,
          disconnect() {},
          getByteTimeDomainData(values: Uint8Array) { values.fill(128); },
        };
      }
      async close() {}
    }
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: Recorder });
    Object.defineProperty(window, "AudioContext", { configurable: true, value: AudioContextStub });
    HTMLMediaElement.prototype.play = async function () {};
  });

  await page.goto("/?view=circuits");
  const sumi = page.getByTestId("companion-open-header");
  const skip = page.getByTestId("companion-skip-intro");
  await expect(page.getByTestId("co-teacher-hands-free")).toHaveCount(0);
  await expect(skip).toBeHidden();

  await sumi.evaluate((button: HTMLButtonElement) => button.click());
  await expect(sumi).toHaveAttribute("data-state", "speaking");
  await expect(skip).toBeVisible();
  const constraints = await page.evaluate(() => (window as any).__sumiMediaConstraints.audio);
  expect(constraints).toMatchObject({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });

  await skip.click();
  await expect(skip).toBeHidden();
  await expect(sumi).toHaveAttribute("data-state", "listening");
  await expect(sumi).toHaveAttribute("aria-label", /Deactivate/);
  expect(await page.evaluate(() => (window as any).__sumiActivationTrack.stopped)).toBe(false);

  await sumi.evaluate((button: HTMLButtonElement) => button.click());
  await expect(sumi).toHaveAttribute("data-state", "idle");
  await expect(sumi).toHaveAttribute("aria-label", /Activate/);
  expect(await page.evaluate(() => (window as any).__sumiActivationTrack.stopped)).toBe(true);
});
