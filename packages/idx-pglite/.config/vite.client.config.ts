import { defineConfig } from "vite-plus";
import { playwright } from "vite-plus/test/browser-playwright";

export default defineConfig({
  oxc: { target: "es2020" },
  test: {
    exclude: ["tests/**/*.server.test.ts"],
    include: ["tests/**/*.test.ts"],

    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }, { browser: "firefox" }, { browser: "webkit" }],
    },
    coverage: {
      include: ["src/**/*.ts"],

      provider: "istanbul",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "./coverage/client",
    },
    testTimeout: 10_000,
  },
});
