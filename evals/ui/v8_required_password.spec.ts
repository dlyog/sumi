import { test, expect } from "@playwright/test";


test("new local accounts require an 8-character password", async ({ page }) => {
  let signupRequests = 0;
  await page.route("**/accounts/signup", async (route) => {
    signupRequests += 1;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "user-password-required",
        email: "required@example.edu",
        display_name: "Required",
        subscription: { plan: "explorer", status: "active" },
      }),
    });
  });

  await page.goto("/");
  await page.getByTestId("signup-open").click();
  const dialog = page.getByTestId("signup-dialog");
  const password = dialog.getByLabel("Password", { exact: true });
  await expect(password).toHaveAttribute("required", "");
  await expect(password).toHaveAttribute("minlength", "8");

  await dialog.getByLabel("Name").fill("Required");
  await dialog.getByLabel("Email").fill("required@example.edu");
  await dialog.getByRole("button", { name: "Create account" }).click();
  await expect(dialog).toBeVisible();
  expect(signupRequests).toBe(0);

  await password.fill("quantum-101");
  await dialog.getByRole("button", { name: "Create account" }).click();
  await expect(dialog).toBeHidden();
  expect(signupRequests).toBe(1);
});
