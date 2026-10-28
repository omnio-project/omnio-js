import { defineConfig } from "vite-plus";

export default defineConfig({
  oxc: { target: "es2020" },
  test: {
    exclude: ["tests/**/*.client.test.ts"],
    include: ["tests/**/*.test.ts"],

    coverage: {
      include: ["src/**/*.ts"],

      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "./coverage/server",
    },
    testTimeout: 10_000,
  },
});
