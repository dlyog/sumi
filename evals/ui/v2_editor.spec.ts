import { test, expect } from "@playwright/test";


test.describe("QuantumYog v0.2 semantic fidelity", () => {
  test("shows a final-IR interpretation and bit-order legend", async ({ page }) => {
    await page.goto("/?view=circuits");
    await expect(page.getByTestId("interpretation-echo")).toContainText(/Built: 2 qubits.*H on q0.*CNOT.*measure/i);
    await expect(page.getByTestId("bit-order-caption")).toContainText(/rightmost bit is q0.*Qiskit convention/i);
  });

  test("step-through shows Bell preparation gate by gate", async ({ page }) => {
    await page.goto("/?view=circuits");
    await page.getByTestId("step-first").click();
    await page.getByTestId("step-next").click();
    const state = page.getByTestId("state-amplitudes");
    await expect(state).toContainText("|00>");
    await expect(state).toContainText("|10>");
    await expect(page.locator(".gate.active-step")).toHaveText("H");
    await page.getByTestId("step-next").click();
    await expect(state).toContainText("|11>");
    await expect(state).not.toContainText("|10>");
  });

  test("Bell state displays an entanglement lesson instead of an empty arrow", async ({ page }) => {
    await page.goto("/?view=circuits");
    await expect(page.getByTestId("entanglement-message")).toBeVisible();
    await expect(page.getByTestId("entanglement-message")).toContainText(/Entangled.*no individual arrow.*joint state/i);
    await expect(page.locator(".wire.entangled-wire")).toHaveCount(2);
  });

  test("state amplitudes are phase-colored and include a legend", async ({ page }) => {
    await page.goto("/?view=circuits");
    await expect(page.getByTestId("phase-legend")).toBeVisible();
    const phaseBars = page.locator(".phase-fill[data-phase]");
    await expect(phaseBars.first()).toBeVisible();
    expect(await phaseBars.first().getAttribute("style")).toContain("hsl");
  });

  test("template chips expand deterministic algorithms and show parameters", async ({ page }) => {
    await page.goto("/?view=circuits");
    await page.getByTestId("template-chip-ghz").click();
    await expect(page.getByTestId("template-used")).toContainText(/GHZ.*qubits.*3/i);
    await expect(page.getByTestId("circuit-canvas")).toContainText("q2");
    await page.getByTestId("template-chip-grover").click();
    await expect(page.getByTestId("template-used")).toContainText(/Grover.*11/i);
    await page.getByTestId("template-chip-deutsch-jozsa").click();
    await expect(page.getByTestId("template-used")).toContainText(/Deutsch.*constant/i);
    await page.getByTestId("template-chip-qrng").click();
    await expect(page.getByTestId("template-used")).toContainText(/QRNG.*qubits.*1/i);
  });
});


test.describe("QuantumYog v0.2 exports and persistence", () => {
  test("source and diagram export controls produce local files", async ({ page }) => {
    await page.goto("/?view=circuits");
    await expect(page.getByTestId("source-copy")).toBeVisible();
    const sourceDownload = page.waitForEvent("download");
    await page.getByTestId("source-download").click();
    expect((await sourceDownload).suggestedFilename()).toMatch(/1stopquantum-(qiskit|cirq)\.py/);
    const svgDownload = page.waitForEvent("download");
    await page.getByTestId("diagram-download-svg").click();
    expect((await svgDownload).suggestedFilename()).toBe("1stopquantum-circuit.svg");
    const pngDownload = page.waitForEvent("download");
    await page.getByTestId("diagram-download-png").click();
    expect((await pngDownload).suggestedFilename()).toBe("1stopquantum-circuit.png");
  });

  test("restores the last prompt and circuit after reload", async ({ page }) => {
    await page.goto("/?view=circuits");
    await page.getByTestId("nl-input").fill("Build a 3-qubit GHZ state.");
    await page.getByTestId("template-chip-ghz").click();
    await page.reload();
    await expect(page.getByTestId("nl-input")).toHaveValue("Build a 3-qubit GHZ state.");
    await expect(page.getByTestId("circuit-canvas")).toContainText("q2");
  });
});


test.describe("QuantumYog v0.2 drug comparison", () => {
  test("renders side-by-side candidates, highlights better values, and lists Lipinski rules", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-drug-discovery").click();
    await page.getByTestId("smiles-input").fill("CC(=O)OC1=CC=CC=C1C(=O)O");
    await page.getByTestId("comparison-smiles").fill("Cn1cnc2c1c(=O)n(C)c(=O)n2C");
    await page.getByTestId("drug-run").click();
    const comparison = page.getByTestId("comparison-scorecard");
    await expect(comparison).toBeVisible();
    await expect(comparison).toContainText("Candidate A");
    await expect(comparison).toContainText("Candidate B");
    await expect(comparison.locator(".better").first()).toBeVisible();
    await expect(page.getByTestId("lipinski-breakdown")).toContainText(/MW.*LogP.*HBD.*HBA/i);
    await expect(page.locator("[data-descriptor='mw']")).toHaveAttribute("title", /molecular weight/i);
  });
});


test.describe("QuantumYog v0.2 provider lab", () => {
  test("editable QUBO round-trips and invalid JSON shows an error", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-providers").click();
    const editor = page.getByTestId("qubo-editor");
    await editor.fill("{not json");
    await page.getByTestId("qubo-run").click();
    await expect(page.getByTestId("qubo-error")).toContainText(/invalid json/i);
    await editor.fill(JSON.stringify({ version: "1.0", kind: "qubo", variables: ["a", "b", "c"], linear: { a: -2, b: -2, c: -2 }, quadratic: { "a,b": 2, "b,c": 2, "a,c": 2 }, num_reads: 50, seed: 42 }));
    await page.getByTestId("qubo-run").click();
    await expect(page.getByTestId("anneal-results")).toContainText(/energy -2/i);
    await expect(page.getByTestId("energy-histogram")).toBeVisible();
    await expect(page.getByTestId("energy-histogram").locator(".best-energy")).toBeVisible();
  });

  test("NL router explains annealing versus circuit choices", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-providers").click();
    await page.getByTestId("route-input").fill("split a triangle graph into two groups");
    await page.getByTestId("route-run").click();
    await expect(page.getByTestId("route-result")).toContainText(/annealing.*optimization/i);
    await page.getByTestId("route-input").fill("entangle two qubits");
    await page.getByTestId("route-run").click();
    await expect(page.getByTestId("route-result")).toContainText(/circuit.*gate/i);
  });
});
