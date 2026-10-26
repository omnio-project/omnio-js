import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    dts: {
      generator: "oxc",
      sourcemap: true,
    },
    entry: ["../src/index.ts"],
    format: ["esm"],
    outDir: "../dist",
    target: "es2020",
    platform: "neutral",
    tsconfig: "tsconfig.build.json",
    sourcemap: true,
    fixedExtension: false,
  },
});
