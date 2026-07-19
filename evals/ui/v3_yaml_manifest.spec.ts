import { test, expect } from "@playwright/test";


const bellYaml = `apiVersion: quantumyog.dev/v1
kind: Circuit
metadata:
  name: bell-yaml-lesson
spec:
  backend: qiskit
  circuit:
    version: "1.0"
    num_qubits: 2
    gates:
      - op: H
        targets: [0]
      - op: CNOT
        controls: [0]
        targets: [1]
      - op: measure
        targets: [0, 1]
    shots: 256
    seed: 42
`;


test("YAML manifests retain metadata while visualizing", async ({ page }) => {
  await page.goto("/?view=circuits");
  await page.getByTestId("input-mode-manifest").click();
  await page.getByTestId("manifest-editor").fill(bellYaml);
  await page.getByTestId("manifest-run").click();

  await expect(page.getByTestId("manifest-error")).toBeHidden();
  await expect(page.getByTestId("manifest-name")).toHaveText("Manifest: bell-yaml-lesson");
  await expect(page.getByTestId("interpretation-echo")).toContainText("Built: 2 qubits");
});
