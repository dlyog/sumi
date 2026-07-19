import { expect, test } from "@playwright/test";


test("lesson media is prebuilt, attributed, and accepts public reactions", async ({ page }) => {
  let feedbackKind = "";
  await page.route("**/feedback", async (route) => {
    const body = route.request().postDataJSON();
    feedbackKind = body.kind;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ likes: body.kind === "like" ? 3 : 2, reports: body.kind === "inaccuracy" ? 1 : 0 }),
    });
  });
  await page.route("**/feedback/summary/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ likes: 2, reports: 0 }),
  }));
  await page.goto("/");

  await expect(page.getByRole("button", { name: /create alternate visual/i })).toHaveCount(0);
  await page.getByTestId("visual-provenance").focus();
  await expect(page.getByTestId("visual-provenance-tooltip")).toContainText(/AI-generated visual/i);
  await expect(page.getByTestId("visual-provenance-tooltip")).toContainText(/Prompt:/i);

  await page.getByTestId("lesson-like").click();
  await expect(page.getByTestId("lesson-like-count")).toHaveText("3");
  expect(feedbackKind).toBe("like");

  await page.getByTestId("lesson-report").click();
  const dialog = page.getByTestId("feedback-dialog");
  await dialog.getByLabel("What looks inaccurate?").fill("The visual needs a clearer distinction between state and measurement.");
  await dialog.getByRole("button", { name: "Send feedback" }).click();
  await expect(dialog).toBeHidden();
  expect(feedbackKind).toBe("inaccuracy");
});


test("the deterministic FAQ assistant and compact legal footer are available", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("faq-assistant-open").click();
  const assistant = page.getByTestId("faq-assistant");
  await expect(assistant).toBeVisible();
  await assistant.getByRole("button", { name: /real quantum computer/i }).click();
  await expect(page.getByTestId("faq-assistant-answer")).toContainText(/simulat/i);

  const footer = page.getByTestId("legal-footer");
  await expect(footer.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/policies.html#terms");
  await expect(footer.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/policies.html#privacy");
  await expect(footer.getByRole("link", { name: "AI use" })).toHaveAttribute("href", "/ai-use.html");
  await expect(footer.getByRole("link", { name: "FAQ" })).toHaveAttribute("href", "/faq.html");
  await expect(footer.getByRole("link", { name: "Credits" })).toHaveAttribute("href", "/credits.html");
  await expect(footer).toContainText(/Trademarks.*no endorsement/i);
  expect(await footer.evaluate((node) => node.getBoundingClientRect().height)).toBeLessThanOrEqual(96);
});


test("admin login is undiscoverable publicly and analytics are role protected", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("admin-open")).toHaveCount(0);
  await expect(page.getByText("Local LLM ready")).toHaveCount(0);

  await page.route("**/admin/signin", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ token: "internal-token", account: { display_name: "Internal reviewer", role: "admin" } }),
  }));
  await page.route("**/admin/analytics", (route) => {
    expect(route.request().headers().authorization).toBe("Bearer internal-token");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        totals: { visitors_today: 12, page_views_today: 48, likes: 9, reports: 2 },
        daily_visitors: [{ date: "2026-07-17", visitors: 12, page_views: 48 }],
        popular_pages: [{ page: "learn:bits-and-qubits", views: 18 }],
        recent_feedback: [{ content_id: "entanglement", kind: "inaccuracy", message: "Clarify the link.", created_at: "2026-07-17T12:00:00Z" }],
      }),
    });
  });
  await page.route("**/admin/llm-settings", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      expect(body.provider).toBe("openai");
      expect(body.api_key).toBe("sk-admin-test");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...body, api_key: undefined, api_key_configured: true }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ provider: "local", base_url: "http://127.0.0.1:8888/v1", model: "local-model", api_key_configured: true }) });
  });

  await page.goto("/?admin=1");
  await page.getByTestId("admin-open").click();
  const login = page.getByTestId("admin-login-dialog");
  await login.getByLabel("Internal email").fill("internal@example.test");
  await login.getByLabel("Internal password").fill("internal-review");
  await login.getByRole("button", { name: "Open analytics" }).click();

  const dashboard = page.getByTestId("admin-dashboard");
  await expect(dashboard).toBeVisible();
  await expect(dashboard).toContainText("12");
  await expect(dashboard).toContainText("learn:bits-and-qubits");
  await expect(dashboard).toContainText("Clarify the link.");
  await dashboard.getByLabel("LLM provider").selectOption("openai");
  await dashboard.getByLabel("LLM API URL").fill("https://api.openai.com/v1");
  await dashboard.getByLabel("LLM model").fill("gpt-5");
  await dashboard.getByLabel("LLM API key").fill("sk-admin-test");
  await dashboard.getByRole("button", { name: "Save LLM settings" }).click();
  await expect(dashboard.getByRole("status")).toContainText(/saved/i);
});
