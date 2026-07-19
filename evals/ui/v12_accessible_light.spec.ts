import { test, expect } from "@playwright/test";


test("the application uses a readable high-contrast light system", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");

  const theme = await page.evaluate(() => {
    const rgb = (value: string) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const luminance = (value: string) => {
      const channels = rgb(value).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const contrast = (foreground: string, background: string) => {
      const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return (values[0] + 0.05) / (values[1] + 0.05);
    };
    const body = getComputedStyle(document.body);
    const sidebar = getComputedStyle(document.querySelector(".sidebar")!);
    const nav = getComputedStyle(document.querySelector(".nav-item")!);
    return {
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      bodyBackgroundLuminance: luminance(body.backgroundColor),
      sidebarBackgroundLuminance: luminance(sidebar.backgroundColor),
      bodyContrast: contrast(body.color, body.backgroundColor),
      bodyFont: Number.parseFloat(body.fontSize),
      navFont: Number.parseFloat(nav.fontSize),
    };
  });

  expect(theme.colorScheme).toContain("light");
  expect(theme.bodyBackgroundLuminance).toBeGreaterThan(0.85);
  expect(theme.sidebarBackgroundLuminance).toBeGreaterThan(0.8);
  expect(theme.bodyContrast).toBeGreaterThanOrEqual(7);
  expect(theme.bodyFont).toBeGreaterThanOrEqual(16);
  expect(theme.navFont).toBeGreaterThanOrEqual(14);
});


test("all primary workspaces inherit the light surface without losing content", async ({ page }) => {
  for (const view of ["learn", "circuits", "drug", "providers", "benchmarking", "improve", "guide"]) {
    await page.goto(`/?view=${view}`);
    const state = await page.evaluate(() => {
      const visible = [...document.querySelectorAll<HTMLElement>(".view-stack > section")].find((node) => !node.hidden)!;
      const background = getComputedStyle(visible).backgroundColor;
      const channels = (background.match(/[\d.]+/g) || ["255", "255", "255"]).slice(0, 3).map(Number);
      return {
        id: visible.id,
        minimumChannel: Math.min(...channels),
        textLength: visible.innerText.trim().length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(state.minimumChannel, `${view} should use a light base surface`).toBeGreaterThanOrEqual(232);
    expect(state.textLength).toBeGreaterThan(80);
    expect(state.overflow).toBeLessThanOrEqual(1);
  }
});


test("keyboard focus and form controls remain visible on white surfaces", async ({ page }) => {
  await page.goto("/?view=circuits");
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement;
    const style = getComputedStyle(active);
    return { tag: active.tagName, outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
  });
  expect(focus.tag).toBe("BUTTON");
  expect(focus.outlineStyle).not.toBe("none");
  expect(focus.outlineWidth).toBeGreaterThanOrEqual(2);

  const inputTheme = await page.locator("#nlInput").evaluate((node) => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, color: style.color, height: node.getBoundingClientRect().height };
  });
  expect(inputTheme.background).toMatch(/rgb\((24[0-9]|25[0-5]),/);
  expect(inputTheme.color).toMatch(/rgb\(([0-5]?[0-9]),/);
  expect(inputTheme.height).toBeGreaterThanOrEqual(42);
});


test("light theme remains touch-friendly and overflow-free on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=benchmarking");
  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    navHeight: document.querySelector<HTMLElement>("[data-testid='nav-benchmarking']")!.getBoundingClientRect().height,
    tabHeight: document.querySelector<HTMLElement>("[data-testid='benchmark-tab-landscape']")!.getBoundingClientRect().height,
    textColor: getComputedStyle(document.querySelector("[data-testid='benchmarking-view']")!).color,
  }));
  expect(layout.overflow).toBeLessThanOrEqual(1);
  expect(layout.navHeight).toBeGreaterThanOrEqual(42);
  expect(layout.tabHeight).toBeGreaterThanOrEqual(42);
  expect(layout.textColor).toMatch(/rgb\(([0-5]?[0-9]),/);
});
