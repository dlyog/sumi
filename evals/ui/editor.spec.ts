import { test, expect } from "@playwright/test";

/**
 * UI evals — the browser-level definition of done.
 *
 * These use stable `data-testid` hooks. The agent must add these testids to the
 * quantumyog extension's DOM. Keeping them stable is part of the contract; do not
 * rename them to dodge a failing test — implement the behavior.
 *
 * Required testids:
 *   nl-input, nl-run, circuit-canvas, histogram, bloch-sphere,
 *   palette, palette-item-H, palette-item-CNOT, palette-item-measure,
 *   backend-select, source-tab-qiskit, source-tab-cirq,
 *   nav-drug-discovery, smiles-input, drug-run, scorecard, clinical-banner,
 *   nl-error
 */

test.describe("QuantumYog editor", () => {
  test("loads with the concept palette and its labeled icons", async ({ page }) => {
    await page.goto("/?view=circuits");
    const palette = page.getByTestId("palette");
    await expect(palette).toBeVisible();
    await expect(palette).toHaveClass(/workspace-gates/);
    await expect(page.locator(".sidebar [data-testid='palette']")).toHaveCount(0);
    // Icons are present AND labeled (accessibility requirement: never color/icon alone).
    await expect(page.getByTestId("palette-item-H")).toBeVisible();
    await expect(page.getByTestId("palette-item-H")).toHaveAttribute("aria-label", /hadamard/i);
    await expect(page.getByTestId("palette-item-CNOT")).toBeVisible();
    await expect(page.getByTestId("palette-item-measure")).toBeVisible();
  });

  test("natural language -> circuit runs and visualizes", async ({ page }) => {
    await page.goto("/?view=circuits");
    await page.getByTestId("nl-input").fill("Entangle two qubits and measure them.");
    await page.getByTestId("nl-run").click();

    // Circuit diagram renders.
    await expect(page.getByTestId("circuit-canvas")).toBeVisible();
    // Histogram appears and shows only correlated Bell outcomes (00 / 11).
    const histogram = page.getByTestId("histogram");
    await expect(histogram).toBeVisible();
    await expect(histogram).toContainText("00");
    await expect(histogram).toContainText("11");
    await expect(histogram).not.toContainText("01");
    await expect(histogram).not.toContainText("10");
    // Bloch sphere panel is present.
    await expect(page.getByTestId("bloch-sphere")).toBeVisible();
  });

  test("shows generated source for both Qiskit and Cirq", async ({ page }) => {
    await page.goto("/?view=circuits");
    await page.getByTestId("nl-input").fill("Put a qubit in superposition and measure it.");
    await page.getByTestId("nl-run").click();

    await page.getByTestId("source-tab-qiskit").click();
    await expect(page.getByTestId("circuit-canvas")).toBeVisible();
    await page.getByTestId("source-tab-cirq").click();
    // Both tabs exist and are switchable; content differs per framework.
    await expect(page.getByTestId("source-tab-cirq")).toHaveAttribute("aria-selected", "true");
  });

  test("non-circuit request shows a friendly error, not a crash", async ({ page }) => {
    await page.goto("/?view=circuits");
    await page.getByTestId("nl-input").fill("What's the weather today?");
    await page.getByTestId("nl-run").click();
    await expect(page.getByTestId("nl-error")).toBeVisible();
    await expect(page.getByTestId("nl-error")).toContainText(/circuit/i);
  });

  test("backend selector switches simulators", async ({ page }) => {
    await page.goto("/?view=circuits");
    const select = page.getByTestId("backend-select");
    await expect(select).toBeVisible();
    await select.selectOption("cirq");
    await page.getByTestId("nl-input").fill("Entangle two qubits and measure them.");
    await page.getByTestId("nl-run").click();
    await expect(page.getByTestId("histogram")).toBeVisible();
  });
});

test.describe("Drug-discovery module", () => {
  test("loads a SMILES string and shows the multi-objective scorecard", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-drug-discovery").click();

    // Clinical-use banner must always be present in this view.
    await expect(page.getByTestId("clinical-banner")).toBeVisible();
    await expect(page.getByTestId("clinical-banner")).toContainText(/not for clinical use/i);

    // Aspirin SMILES.
    await page.getByTestId("smiles-input").fill("CC(=O)OC1=CC=CC=C1C(=O)O");
    await page.getByTestId("drug-run").click();

    const card = page.getByTestId("scorecard");
    await expect(card).toBeVisible();
    // Scorecard surfaces the multi-objective axes (not just binding).
    await expect(card).toContainText(/drug-?likeness|QED/i);
    await expect(card).toContainText(/toxicity/i);
    await expect(card).toContainText(/synthes|synthetic/i);
    await expect(card).toContainText(/binding/i);
  });

  test("invalid SMILES is handled gracefully", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-drug-discovery").click();
    await page.getByTestId("smiles-input").fill("not-a-real-smiles");
    await page.getByTestId("drug-run").click();
    // Shows an error state rather than crashing the view.
    await expect(page.getByTestId("scorecard")).not.toBeVisible();
    await expect(page.getByText(/invalid|couldn.t parse|not a valid/i)).toBeVisible();
  });
});
