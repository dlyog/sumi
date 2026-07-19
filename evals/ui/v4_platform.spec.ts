import { test, expect } from "@playwright/test";


test.describe("QuantumYog v0.4 documentation center", () => {
  test("provides searchable end-user documentation inside the app", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-guide").click();
    const docs = page.getByTestId("documentation-view");
    await expect(docs).toBeVisible();
    await expect(docs.getByRole("heading", { name: "1StopQuantum Documentation" })).toBeVisible();
    await expect(docs.getByTestId("docs-sidebar")).toContainText("Getting started");
    await expect(docs.getByTestId("docs-sidebar")).toContainText("API reference");

    await docs.getByTestId("docs-search").fill("MCP");
    await expect(docs.getByTestId("docs-search-results")).toContainText(/ChatGPT.*MCP/i);
    await docs.getByTestId("docs-search-results").getByRole("button").first().click();
    await expect(docs.getByTestId("docs-article")).toContainText("/mcp");
  });

  test("documents both ChatGPT app and Custom GPT connection paths", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("nav-guide").click();
    await page.getByTestId("docs-link-chatgpt").click();
    const article = page.getByTestId("docs-article");
    await expect(article).toContainText("ChatGPT app");
    await expect(article).toContainText("Custom GPT Action");
    await expect(article).toContainText("HTTPS");
  });
});


test.describe("QuantumYog v0.4 membership and improvement lab", () => {
  test("signs up for an educational subscription plan", async ({ page }) => {
    await page.route("**/accounts/signup", async (route) => {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: "user-ada",
          email: "ada@example.edu",
          display_name: "Ada",
          subscription: { plan: "scholar", status: "active" },
        }),
      });
    });
    await page.goto("/");
    await page.getByTestId("signup-open").click();
    const dialog = page.getByTestId("signup-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Name").fill("Ada");
    await dialog.getByLabel("Email").fill("ada@example.edu");
    await dialog.getByLabel("Password", { exact: true }).fill("quantum-lesson");
    await dialog.getByLabel("Plan").selectOption("scholar");
    await dialog.getByRole("button", { name: "Create account" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("account-status")).toContainText("Ada · Scholar");
  });

  test("schedules and reviews a bounded circuit improvement job", async ({ page }) => {
    await page.route("**/improvements/jobs", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            id: "job-1",
            status: "completed",
            objective: "Reduce gate count",
            schedule_at: "2026-07-16T12:00:00Z",
            report_url: "/improvements/reports/job-1.html",
            result: {
              accepted: true,
              before_metrics: { unitary_gates: 4 },
              after_metrics: { unitary_gates: 2 },
            },
          }),
        });
      } else {
        await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      }
    });
    await page.goto("/");
    await page.getByTestId("nav-improve").click();
    const lab = page.getByTestId("improvement-view");
    await expect(lab).toBeVisible();
    await lab.getByLabel("Optimization objective").fill("Reduce gate count");
    await lab.getByLabel("Maximum iterations").fill("3");
    await lab.getByRole("button", { name: "Run review now" }).click();
    await expect(lab.getByTestId("improvement-status")).toContainText(/accepted.*4.*2/i);
    await expect(lab.getByTestId("improvement-report")).toHaveAttribute("href", /reports\/job-1/);
  });
});
