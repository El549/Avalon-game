import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit-mobile", grep: /两台手机/, use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    command: "./node_modules/.bin/tsx src/server/index.ts",
    url: "http://127.0.0.1:4173/api/health",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
