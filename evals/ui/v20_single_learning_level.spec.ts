import { expect, test } from "@playwright/test";


test("one learning-level control updates the visible introduction", async ({ page }) => {
  await page.goto("/");

  const learning = page.getByTestId("learning-view");
  await expect(learning.getByRole("group", { name: "Learning level" })).toBeVisible();
  await expect(learning.getByRole("button", { name: "Beginner", exact: true })).toHaveCount(0);
  await expect(learning.getByRole("button", { name: "Executive", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("learning-reset")).toHaveCount(0);

  const introTitle = page.locator("#classicalIntroTitle");
  const lessonMeta = page.locator("#courseLessonMeta");
  await expect(introTitle).toContainText(/computer.*quantum coprocessor/i);
  await expect(lessonMeta).toContainText("High school");

  await page.getByTestId("level-undergraduate").click();
  await expect(introTitle).toContainText(/state vectors.*classical baseline/i);
  await expect(page.locator("#classicalIntroSummary")).toContainText(/amplitude|circuit/i);
  await expect(lessonMeta).toContainText("Undergraduate");

  await page.getByTestId("level-masters").click();
  await expect(introTitle).toContainText(/opportunity and risk/i);
  await expect(lessonMeta).toContainText("Master's");
});
