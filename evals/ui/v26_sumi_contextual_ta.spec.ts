import { expect, test } from "@playwright/test";

async function signIn(page) {
  await page.addInitScript(() => localStorage.setItem("quantumyog.account.v1", JSON.stringify({
    id: "local-sumi-context-test",
    display_name: "Sumi context tester",
    role: "scholar",
    subscription: { plan: "scholar", status: "active" },
  })));
  await page.route("**/accounts/local-sumi-context-test", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ id: "local-sumi-context-test", display_name: "Sumi context tester", role: "scholar", subscription: { plan: "scholar", status: "active" } }),
  }));
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
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

test("Sumi free-form answers receive the active Learn screen context", async ({ page }) => {
  let answerContext: Record<string, unknown> | undefined;
  await page.route("**/api/v1/co-teacher/route", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ action: "answer_question", experiment: "" }),
  }));
  await page.route("**/api/v1/co-teacher/answer", async (route) => {
    answerContext = route.request().postDataJSON().context;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ answer: "This Learn page guides you through Bits and qubits." }) });
  });
  await page.route("**/api/v1/co-teacher/speak", (route) => route.fulfill({ status: 200, contentType: "audio/wav", body: "RIFF" }));
  await page.goto("/?view=learn");

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("sumi:test-transcript", { detail: "What is this page for?" })));
  await expect.poll(() => answerContext).toBeTruthy();
  expect(answerContext?.screen_id).toBe("learn");
  expect(answerContext?.screen).toBe("Learn");
  expect(String(answerContext?.description)).toContain("Learn workspace");
  expect(JSON.stringify(answerContext?.visible_state)).toContain("Bits and qubits");
  expect(JSON.stringify(answerContext)).not.toContain("Algorithm Studio");
});

test("FAQ is a normal navigation page after Community and never a covering popup", async ({ page }) => {
  await page.goto("/");
  const navItems = page.locator(".primary-nav > .nav-item, .primary-nav > .nav-group");
  await expect(page.getByTestId("nav-faq")).toBeVisible();
  expect(await navItems.last().getAttribute("id")).toBe("navFaq");
  await page.getByTestId("nav-faq").click();
  await expect(page.getByTestId("faq-view")).toBeVisible();
  await expect(page.getByTestId("faq-view")).toContainText("Does this run on a real quantum computer?");
  await expect(page.getByTestId("faq-assistant")).toHaveCount(0);
  const position = await page.getByTestId("faq-view").evaluate((node) => getComputedStyle(node).position);
  expect(position).not.toBe("fixed");
});

test("floating Sumi activates voice directly and conversation stays in document flow", async ({ page }) => {
  await page.goto("/?view=learn");
  const sumi = page.getByTestId("faq-assistant-open");
  await sumi.click();
  await expect(sumi).toHaveAttribute("data-state", /thinking|speaking|listening/);
  await expect(page.getByTestId("co-teacher-turn")).toBeVisible();
  expect(await page.getByTestId("co-teacher-turn").evaluate((node) => getComputedStyle(node).position)).toBe("static");
});

test("Sumi uses different listening and speaking motion languages", async ({ page }) => {
  await page.goto("/?view=learn");
  const animation = async (state: string) => page.getByTestId("faq-assistant-open").evaluate((node, nextState) => {
    (node as HTMLElement).dataset.state = nextState;
    return getComputedStyle(node).animationName;
  }, state);
  expect(await animation("listening")).toContain("sumi-listen");
  expect(await animation("speaking")).toContain("sumi-speak");
  expect(await animation("listening")).not.toBe(await animation("speaking"));
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 820, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`contextual Sumi layout has no horizontal overflow on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/?view=learn");
    await page.getByTestId("faq-assistant-open").click();
    await expect(page.getByTestId("co-teacher-turn")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/v26-sumi-${viewport.name}.png`, fullPage: true });
  });
}
