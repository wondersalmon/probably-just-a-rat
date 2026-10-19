import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test-ui",
  workers: 1,
  outputDir: "dev/test-results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "dev/playwright-report", open: "never" }]
  ],
  use: {
    baseURL: "http://127.0.0.1:4179",
    viewport: { width: 900, height: 650 },
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "node tools/ui-server.mjs",
    url: "http://127.0.0.1:4179",
    reuseExistingServer: false
  }
});
