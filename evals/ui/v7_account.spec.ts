import { test, expect } from "@playwright/test";


test("signup, logout, returning sign-in, and reload form a complete local account lifecycle", async ({ page }) => {
  const account = {
    id: "user-katherine",
    email: "katherine@example.edu",
    display_name: "Katherine",
    subscription: { plan: "scholar", status: "active" },
  };
  await page.route("**/accounts/signup", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify(account),
  }));
  await page.route("**/accounts/signin", async (route) => {
    const body = route.request().postDataJSON();
    if (body.email === account.email && body.password === "orbital-lesson") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(account) });
    } else {
      await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "invalid email or password" }) });
    }
  });

  await page.goto("/");
  await expect(page.getByTestId("signin-open")).toBeVisible();
  await page.getByTestId("signup-open").click();
  const signup = page.getByTestId("signup-dialog");
  await signup.getByLabel("Name").fill("Katherine");
  await signup.getByLabel("Email").fill(account.email);
  await signup.getByLabel("Password", { exact: true }).fill("orbital-lesson");
  await signup.getByLabel("Plan").selectOption("scholar");
  await signup.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByTestId("account-status")).toContainText("Katherine · Scholar");
  await expect(page.getByTestId("account-logout")).toBeVisible();
  await expect(page.getByTestId("signup-open")).toBeHidden();

  await page.getByTestId("account-logout").click();
  await expect(page.getByTestId("account-status")).toHaveText("Local guest");
  await expect(page.getByTestId("signin-open")).toBeVisible();

  await page.getByTestId("signin-open").click();
  const signin = page.getByTestId("signin-dialog");
  await signin.getByLabel("Email").fill(account.email);
  await signin.getByLabel("Password").fill("bad-password");
  await signin.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(signin.getByRole("alert")).toContainText(/invalid email or password/i);
  await signin.getByLabel("Password").fill("orbital-lesson");
  await signin.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(signin).toBeHidden();
  await expect(page.getByTestId("account-status")).toContainText("Katherine · Scholar");

  await page.reload();
  await expect(page.getByTestId("account-status")).toContainText("Katherine · Scholar");
  await expect(page.getByTestId("account-logout")).toBeVisible();
});


test("Quantum 101 documentation opens the real interactive Learn workspace", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-guide").click();
  await page.getByRole("button", { name: "Quantum 101" }).click();
  await page.getByTestId("docs-open-learn").click();
  await expect(page.getByTestId("learning-view")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Learn quantum computing by doing" })).toBeVisible();
  await expect(page.getByTestId("learning-webgl")).toHaveAttribute("data-render-ready", "true");
  await expect(page.getByTestId("lesson-run-simulation")).toBeDisabled();
});
