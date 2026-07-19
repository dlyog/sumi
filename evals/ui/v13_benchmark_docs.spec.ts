import { expect, test } from "@playwright/test";

test("benchmark methodology and limits are available in the in-app guide", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-guide").click();
  await page.getByRole("button", { name: "Benchmark intelligence" }).click();

  await expect(page.getByRole("heading", { name: "Benchmark intelligence" })).toBeVisible();
  await expect(page.getByTestId("docs-article")).toContainText("fit score");
  await expect(page.getByTestId("docs-article")).toContainText("evidence score");
  await expect(page.getByTestId("docs-article")).toContainText("not a DARPA determination");
  await expect(page.getByTestId("docs-article").getByRole("link", { name: "Metriq" })).toHaveAttribute("href", "https://metriq.info/");
  await expect(page.getByTestId("docs-article").getByRole("link", { name: "DARPA QBI" })).toHaveAttribute("href", /darpa\.mil\/research\/programs\/quantum-benchmarking-initiative/);
});
