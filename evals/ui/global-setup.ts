import { request, type FullConfig } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";


export const AUTH_STATE = resolve(process.cwd(), ".run", "playwright-demo.json");


export default async function globalSetup(config: FullConfig) {
  const browserBase = String(config.projects[0]?.use?.baseURL || "http://localhost:8080");
  const apiBase = process.env.QLAB_API_URL || "http://localhost:8000";
  const client = await request.newContext({ baseURL: apiBase });
  const response = await client.post("/accounts/signin", {
    data: { email: "learner@1stopquantum.local", password: "LearnQuantum2026!" },
  });
  if (!response.ok()) {
    throw new Error(`Playwright demo sign-in failed with ${response.status()}. Run scripts/provision_postgres.py.`);
  }
  const account = await response.json();
  await client.dispose();
  mkdirSync(dirname(AUTH_STATE), { recursive: true });
  writeFileSync(AUTH_STATE, JSON.stringify({
    cookies: [],
    origins: [{
      origin: new URL(browserBase).origin,
      localStorage: [{ name: "quantumyog.account.v1", value: JSON.stringify(account) }],
    }],
  }, null, 2));
}
