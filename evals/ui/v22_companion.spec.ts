import { test, expect } from "@playwright/test";

async function stubVoice(
  page: import("@playwright/test").Page,
  action = "demonstrate_grover",
  transcription = "Show me Grover search",
  answer = "Grover's diffusion step increases the marked state's amplitude relative to the others.",
) {
  await page.addInitScript(() => {
    Object.assign(window, { __sumiTestVoice: false, __sumiRecorderStarted: false, __sumiMediaConstraints: null });
    HTMLMediaElement.prototype.play = async function () {
      if (this.src.includes("experiment_menu")) return;
      window.setTimeout(() => this.onended?.(new Event("ended")), 1000);
    };
    class Recorder {
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() { this.state = "recording"; (window as any).__sumiRecorderStarted = true; }
      stop() { this.state = "inactive"; (window as any).__sumiRecorderStarted = false; this.ondataavailable?.({ data: new Blob(["voice"], { type: "audio/webm" }) }); this.onstop?.(); }
    }
    let analyserReads = 0;
    class AudioContextStub {
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createAnalyser() {
        return {
          fftSize: 0,
          disconnect() {},
          getByteTimeDomainData(values: Uint8Array) {
            if ((window as any).__sumiTestVoice && analyserReads < 8) analyserReads += 1;
            values.fill((window as any).__sumiTestVoice && analyserReads < 8 ? 170 : 128);
          },
        };
      }
      async close() {}
    }
    Object.defineProperty(window, "MediaRecorder", { value: Recorder });
    Object.defineProperty(window, "AudioContext", { value: AudioContextStub });
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: async (constraints: MediaStreamConstraints) => { (window as any).__sumiMediaConstraints = constraints; return { getTracks: () => [{ stop() {} }] }; } } });
  });
  await page.route("http://127.0.0.1:5152/api/transcribe", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, transcription }) }));
  await page.route("**/api/v1/co-teacher/route", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ action, experiment: transcription }) }));
  await page.route("**/api/v1/co-teacher/answer", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ answer }) }));
  await page.route("**/api/v1/co-teacher/speak", async (route) => route.fulfill({ status: 200, contentType: "audio/wav", body: "RIFFvoice" }));
}

async function clickCoTeacher(page: import("@playwright/test").Page) {
  await page.getByTestId("companion-open-header").evaluate((button: HTMLButtonElement) => button.click());
}

async function startListening(page: import("@playwright/test").Page) {
  const icon = page.getByTestId("companion-open-header");
  await clickCoTeacher(page);
  await expect(icon).toHaveAttribute("data-state", "speaking");
  await page.getByTestId("companion-skip-intro").evaluate((button: HTMLButtonElement) => button.click());
  await expect(icon).toHaveAttribute("data-state", "listening");
  await page.evaluate(() => { (window as any).__sumiTestVoice = true; });
  await page.waitForFunction(() => (window as any).__sumiRecorderStarted === true);
}

test.describe("v22 icon-only AI Co-Teacher", () => {
  test("activates without a blocking popup and highlights real controls", async ({ page }) => {
    await stubVoice(page);
    await page.goto("/?view=circuits");
    const icon = page.getByTestId("companion-open-header");
    await expect(icon).toBeVisible();
    await expect(page.locator(".sidebar [data-testid='palette']")).toHaveCount(0);
    await expect(page.locator(".workspace-gates")).toBeVisible();
    await clickCoTeacher(page);
    const live = page.getByTestId("companion-live");
    const liveBox = await live.boundingBox();
    expect(liveBox?.width || 0).toBeLessThanOrEqual(1);
    expect(liveBox?.height || 0).toBeLessThanOrEqual(1);
    await expect(page.locator("dialog.companion-dialog")).toHaveCount(0);
    await expect(icon).toHaveAttribute("data-state", "speaking");
    await expect(page.locator(".co-teacher-highlight")).toHaveCount(1);
    await page.getByTestId("companion-skip-intro").evaluate((button: HTMLButtonElement) => button.click());
    await expect(live).toContainText("Intro skipped");
  });

  test("records, transcribes, executes Grover through real controls, and narrates", async ({ page }) => {
    await stubVoice(page);
    await page.goto("/?view=circuits");
    await startListening(page);
    await expect(page.getByTestId("companion-note")).toContainText("Listening");
    await clickCoTeacher(page);
    await expect(page.locator("#nlInput")).toHaveValue("Grover search for |11> on 2 qubits.");
    await expect(page.getByTestId("companion-note")).toContainText("Ready");
  });

  test("routes a combined screen explanation and experiment through real controls", async ({ page }) => {
    await stubVoice(
      page,
      "guided_experiment",
      "Explain how to use this screen and perform an experiment and show it to me",
    );
    await page.goto("/?view=circuits");
    await startListening(page);
    await clickCoTeacher(page);
    await expect(page.locator("#nlInput")).toHaveValue("Grover search for |11> on 2 qubits.");
    await expect(page.getByTestId("interpretation-echo")).toContainText("Built: 2 qubits");
    await expect(page.getByTestId("companion-note")).toContainText("Ready");
  });

  test("explains available experiments instead of running a vague request", async ({ page }) => {
    await stubVoice(page, "explain_experiments", "Run a specific circuit algorithm");
    let generationRequests = 0;
    await page.route("**/nl2manifest", async (route) => {
      generationRequests += 1;
      await route.continue();
    });
    await page.goto("/?view=circuits");
    await page.evaluate(() => {
      const error = document.getElementById("nlError");
      if (error) { error.hidden = false; error.textContent = "That does not look like a quantum circuit request."; }
    });
    await startListening(page);
    await clickCoTeacher(page);
    await expect(page.getByTestId("companion-note")).toHaveAttribute("title", /Bell pair.*Grover/);
    await expect(page.getByTestId("companion-open-header")).toHaveAttribute("data-state", "speaking");
    expect(generationRequests).toBe(0);
    await expect(page.getByTestId("nl-error")).toBeHidden();
  });

  test("selects and runs a named experiment through visible controls", async ({ page }) => {
    await stubVoice(page, "run_named_experiment", "ghz");
    await page.goto("/?view=circuits");
    await startListening(page);
    await clickCoTeacher(page);
    await expect(page.locator("#samplePromptSelect")).toHaveValue("Entangle three qubits and measure them.");
    await expect(page.locator("#nlInput")).toHaveValue("Entangle three qubits and measure them.");
    await expect(page.getByTestId("interpretation-echo")).toContainText("Built: 3 qubits");
    await expect(page.getByTestId("nl-error")).toBeHidden();
  });

  test("treats a one-word Grover request as an approved experiment action", async ({ page }) => {
    await stubVoice(page, "run_named_experiment", "grover");
    let generationRequests = 0;
    await page.route("**/nl2manifest", async (route) => {
      generationRequests += 1;
      await route.continue();
    });
    await page.goto("/?view=circuits");
    await startListening(page);
    await clickCoTeacher(page);
    await expect(page.locator("#nlInput")).toHaveValue("Grover search for |11> on 2 qubits.");
    await expect(page.getByTestId("interpretation-echo")).toContainText("Built: 2 qubits");
    await expect(page.getByTestId("nl-error")).toBeHidden();
    await expect.poll(() => generationRequests).toBe(1);
  });

  test("answers a natural question without mutating the circuit", async ({ page }) => {
    await stubVoice(page, "answer_question", "Why does Grover use diffusion?");
    let answerRequests = 0;
    let generationRequests = 0;
    await page.route("**/api/v1/co-teacher/answer", async (route) => {
      answerRequests += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ answer: "Diffusion increases the target amplitude relative to the others." }) });
    });
    await page.route("**/nl2manifest", async (route) => {
      generationRequests += 1;
      await route.continue();
    });
    await page.goto("/?view=circuits");
    await startListening(page);
    await clickCoTeacher(page);
    await expect(page.getByTestId("companion-note")).toHaveAttribute("title", /Diffusion increases/);
    expect(answerRequests).toBe(1);
    expect(generationRequests).toBe(0);
  });

  test("one Sumi control enables duplex mode and submits after detected silence", async ({ page }) => {
    await stubVoice(page, "run_named_experiment", "grover");
    await page.goto("/?view=circuits");
    await expect(page.getByTestId("co-teacher-hands-free")).toHaveCount(0);
    await startListening(page);
    expect(await page.evaluate(() => (window as any).__sumiMediaConstraints.audio)).toMatchObject({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
    await expect(page.locator("#nlInput")).toHaveValue("Grover search for |11> on 2 qubits.", { timeout: 6000 });
  });

  test("uses a bounded breathing animation instead of rotating Sumi", async ({ page }) => {
    await stubVoice(page);
    await page.goto("/?view=circuits");
    const icon = page.getByTestId("companion-open-header");
    await icon.evaluate((button: HTMLElement) => { button.dataset.state = "thinking"; });
    const animationName = await icon.evaluate((button) => getComputedStyle(button).animationName);
    expect(animationName).not.toContain("spin");
    expect(animationName).toContain("co-teacher-breathe");
  });

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    test(`remains compact at ${viewport.width}px`, async ({ page }) => {
      await stubVoice(page);
      await page.setViewportSize(viewport);
      await page.goto("/?view=circuits");
      await clickCoTeacher(page);
      const live = page.getByTestId("companion-live");
      const liveBox = await live.boundingBox();
      expect(liveBox?.width || 0).toBeLessThanOrEqual(1);
      expect(liveBox?.height || 0).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await page.screenshot({ path: `.run/co-teacher-${viewport.width}.png`, fullPage: false });
    });
  }
});
