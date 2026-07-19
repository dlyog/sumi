import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

/**
 * Playwright config for QuantumYog UI evals.
 *
 * Assumes the Monaco learning workspace is served at BASE_URL and the backend is
 * reachable by the frontend. For CI, the webServer
 * block can boot both via a single script; for local runs, start them yourself and
 * point BASE_URL at the running instance.
 */
const BASE_URL = process.env.QLAB_BASE_URL ?? "http://localhost:8080";
const AUTH_STATE = resolve(process.cwd(), ".run", "playwright-demo.json");
const GUEST_TESTS = /signup, logout|new local accounts require|signs up for an educational subscription|sign in offers a demo learner|locked workspace navigation/i;

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-authenticated",
      grepInvert: GUEST_TESTS,
      use: { ...devices["Desktop Chrome"], storageState: AUTH_STATE },
    },
    {
      name: "chromium-guest",
      grep: GUEST_TESTS,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Uncomment to have Playwright boot the stack itself in CI:
  // webServer: {
  //   command: "make demo",
  //   url: BASE_URL,
  //   reuseExistingServer: !process.env.CI,
  //   timeout: 120_000,
  // },
});
