import { test, expect } from "@playwright/test";


const ghzManifest = {
  apiVersion: "quantumyog.dev/v1",
  kind: "Circuit",
  metadata: { name: "ghz-browser-lesson" },
  spec: {
    backend: "qiskit",
    circuit: {
      version: "1.0",
      num_qubits: 3,
      gates: [
        { op: "H", targets: [0] },
        { op: "CNOT", controls: [0], targets: [1] },
        { op: "CNOT", controls: [0], targets: [2] },
        { op: "measure", targets: [0, 1, 2] },
      ],
      shots: 256,
      seed: 42,
    },
  },
};


test.describe("QuantumYog declarative manifests", () => {
  test("loads JSON from the manifest editor and visualizes it", async ({ page }) => {
    await page.goto("/?view=circuits");
    await page.getByTestId("input-mode-manifest").click();
    await expect(page.getByTestId("manifest-editor")).toBeVisible();
    await page.getByTestId("manifest-editor").fill(JSON.stringify(ghzManifest));
    await page.getByTestId("manifest-run").click();
    await expect(page.getByTestId("manifest-error")).toBeHidden();
    await expect(page.getByTestId("circuit-canvas")).toContainText("q2");
    await expect(page.getByTestId("interpretation-echo")).toContainText(/Built: 3 qubits.*CNOT/i);
  });

  test("shows and downloads the canonical manifest beside generated code", async ({ page }) => {
    await page.goto("/?view=circuits");
    await page.getByTestId("source-tab-manifest").click();
    const source = page.locator("#sourcePanel");
    await expect(source).toContainText("apiVersion: quantumyog.dev/v1");
    await expect(source).toContainText("kind: Circuit");
    const download = page.waitForEvent("download");
    await page.getByTestId("source-download").click();
    expect((await download).suggestedFilename()).toBe("1stopquantum-manifest.qyog.yaml");
  });

  test("opens CLI visualization deep links", async ({ page }) => {
    const encoded = Buffer.from(JSON.stringify(ghzManifest)).toString("base64url");
    await page.goto(`/#manifest=${encoded}`);
    await expect(page.getByTestId("circuit-canvas")).toContainText("q2");
    await expect(page.getByTestId("manifest-name")).toContainText("ghz-browser-lesson");
  });

  test("provides an in-app academic tutorial", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-guide").click();
    const guide = page.getByTestId("tutorial-view");
    await expect(guide).toBeVisible();
    await expect(guide).toContainText(/first circuit/i);
    await expect(guide).toContainText(/step-through/i);
    await expect(guide).toContainText(/qyog validate/i);
    await expect(guide).toContainText(/YAML|JSON/);
  });
});
