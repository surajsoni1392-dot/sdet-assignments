const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4177",
    extraHTTPHeaders: { Accept: "application/json" },
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node src/server.js",
    url: "http://127.0.0.1:4177/health",
    reuseExistingServer: !process.env.CI,
    timeout: 15_000
  }
});