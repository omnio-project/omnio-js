import { defineConfig } from "vite-plus";

export default defineConfig({
  oxc: { target: "es2020" },
  pack: {
    dts: {
      generator: "oxc",
      sourcemap: true,
    },
    entry: ["../src/index.ts"],
    format: ["esm"],
    outDir: "../dist",
    target: "es2020",
    platform: "node",
    tsconfig: "tsconfig.build.json",
    sourcemap: true,
    fixedExtension: false,
  },
  test: {
    include: ["tests/**/*.test.ts"],

    // テストファイルごとに専用のスキーマーを作り直します。
    // しかし kysely のマイグレーターは接続先の全スキーマーを introspection します。
    // 並行して別ファイルがスキーマーを削除すると "relation ... does not exist" で失敗します。
    // そのため、テストファイルは直列に実行します。
    fileParallelism: false,

    coverage: {
      include: ["src/**/*.ts"],

      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "./coverage",
    },
  },
});
