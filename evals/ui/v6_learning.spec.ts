import { test, expect } from "@playwright/test";


test.describe("QuantumYog interactive Quantum 101", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-learn").click();
  });

  test("starts at foundations and adapts explanations to learner level", async ({ page }) => {
    await expect(page.getByTestId("learning-view")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Learn quantum computing by doing" })).toBeVisible();
    await expect(page.getByTestId("lesson-title")).toContainText(/bit.*qubit/i);
    await expect(page.getByTestId("lesson-explanation")).toContainText(/switch|coin/i);
    await expect(page.getByTestId("classical-comparison")).toContainText(/classical/i);

    await page.getByTestId("level-undergraduate").click();
    await expect(page.getByTestId("lesson-explanation")).toContainText(/vector|amplitude/i);
    await page.getByTestId("level-masters").click();
    await expect(page.getByTestId("lesson-explanation")).toContainText(/Hilbert|ket|complex/i);
  });

  test("renders a nonblank WebGL Bloch sphere and D3 classical comparison", async ({ page }) => {
    await page.getByTestId("lesson-tab-qubit").click();
    const canvas = page.getByTestId("learning-webgl");
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveAttribute("data-render-ready", "true");

    const pixels = await page.evaluate(() => (window as any).__quantumyogTutorialPixelStats());
    expect(pixels.nonBackground).toBeGreaterThan(500);
    expect(pixels.distinctColors).toBeGreaterThan(10);

    const chart = page.getByTestId("classical-quantum-chart");
    await expect(chart.locator("svg")).toBeVisible();
    await expect(chart).toContainText("Classical bit");
    await expect(chart).toContainText("Qubit measurement");

    await page.getByTestId("theta-slider").fill("180");
    await expect(page.getByTestId("state-readout")).toContainText(/P\(1\).*100%/i);
  });

  test("asks for a prediction, runs a practical simulation, and opens its circuit", async ({ page }) => {
    await page.getByTestId("lesson-tab-superposition").click();
    await expect(page.getByTestId("lesson-run-simulation")).toBeDisabled();
    await page.getByTestId("prediction-balanced").click();
    await page.getByTestId("lesson-run-simulation").click();

    const result = page.getByTestId("lesson-simulation-result");
    await expect(result).toBeVisible();
    await expect(result).toContainText("0");
    await expect(result).toContainText("1");
    await expect(result).toContainText(/prediction.*correct/i);

    await page.getByTestId("open-circuit-studio").click();
    await expect(page.getByRole("heading", { name: "Algorithm studio" })).toBeVisible();
    await expect(page.getByTestId("circuit-canvas")).toContainText("H");
    await expect(page.getByTestId("circuit-canvas")).toContainText("M");
  });

  test("gives checkpoint feedback and restores lesson progress", async ({ page }) => {
    await page.getByTestId("checkpoint-wrong").click();
    await expect(page.getByTestId("checkpoint-feedback")).toContainText(/not quite/i);
    await page.getByTestId("checkpoint-correct").click();
    await expect(page.getByTestId("checkpoint-feedback")).toContainText(/correct/i);
    await expect(page.getByTestId("course-progress")).toHaveAttribute("value", "1");

    await page.reload();
    await page.getByTestId("nav-learn").click();
    await expect(page.getByTestId("checkpoint-feedback")).toContainText(/completed/i);
  });

  test("defines unfamiliar terms in a searchable in-app glossary", async ({ page }) => {
    await page.getByTestId("glossary-search").fill("entanglement");
    const glossary = page.getByTestId("glossary-results");
    await expect(glossary).toContainText("Entanglement");
    await expect(glossary).toContainText(/joint state|cannot be described independently/i);
    await expect(glossary).not.toContainText("Backend");
  });

  test("keeps the lesson and controls readable on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("lesson-tab-qubit").click();
    await expect(page.getByTestId("learning-webgl")).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const boxes = await Promise.all([
      page.getByTestId("learning-webgl").boundingBox(),
      page.getByTestId("state-readout").boundingBox(),
      page.getByTestId("classical-quantum-chart").boundingBox(),
    ]);
    expect(boxes.every(Boolean)).toBeTruthy();
    expect(boxes[0]!.y + boxes[0]!.height).toBeLessThanOrEqual(boxes[1]!.y + 1);
    expect(boxes[1]!.y + boxes[1]!.height).toBeLessThanOrEqual(boxes[2]!.y + 1);
  });

  test("puts Quantum 101 before Bell circuits in the in-app documentation", async ({ page }) => {
    await page.getByTestId("nav-guide").click();
    await page.getByRole("button", { name: "Quantum 101" }).click();
    const article = page.getByTestId("docs-article");
    await expect(article).toContainText(/classical bit/i);
    await expect(article).toContainText(/high school.*undergraduate.*master/i);
    await expect(article).toContainText(/Learn workspace/i);
  });
});
