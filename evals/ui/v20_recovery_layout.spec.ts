import { test, expect } from "@playwright/test";


test("sign in offers a demo learner and challenge recovery", async ({ page }) => {
  await page.route("**/accounts/recovery/challenge", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      password_hint: "A quantum state concept",
      recovery_question: "What recovery word did you choose?",
    }),
  }));
  await page.route("**/accounts/recovery/reset", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ changed: true }),
  }));

  await page.goto("/");
  await page.getByTestId("signin-open").click();
  const signin = page.getByTestId("signin-dialog");
  await expect(signin.getByRole("heading", { name: "Sign in to 1StopQuantum" })).toBeVisible();
  await signin.getByRole("button", { name: "Use demo account" }).click();
  await expect(signin.getByLabel("Email")).toHaveValue("learner@1stopquantum.local");
  await expect(signin.getByLabel("Password")).toHaveValue("LearnQuantum2026!");

  await signin.getByRole("button", { name: "Forgot password?" }).click();
  const recovery = page.getByTestId("recovery-dialog");
  await recovery.getByLabel("Account email").fill("learner@1stopquantum.local");
  await recovery.getByRole("button", { name: "Show recovery question" }).click();
  await expect(recovery).toContainText("A quantum state concept");
  await expect(recovery).toContainText("What recovery word did you choose?");
  await recovery.getByLabel("Recovery answer").fill("superposition");
  await recovery.getByLabel("New password").fill("new-demo-password");
  await recovery.getByRole("button", { name: "Reset password" }).click();
  await expect(recovery.getByRole("status")).toContainText("Password reset");
});


test("locked workspace navigation and footer stay aligned", async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 1228 });
  await page.goto("/");

  const buttons = page.locator(".primary-nav .nav-item");
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const box = await buttons.nth(index).boundingBox();
    expect(box?.height).toBeLessThanOrEqual(48);
  }
  const lockContent = await page.getByTestId("nav-podcast").evaluate((node) =>
    getComputedStyle(node, "::after").content
  );
  expect(lockContent).toContain("🔒");

  const footer = page.getByTestId("legal-footer");
  await footer.scrollIntoViewIfNeeded();
  const footerBox = await footer.boundingBox();
  expect(footerBox?.height).toBeLessThanOrEqual(108);
  await expect(footer.getByRole("link", { name: "Privacy" })).toBeVisible();
});
