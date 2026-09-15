import { defineConfig } from "tsup";

export default defineConfig([
  // npm build: ESM + .d.ts. `firebase/*` stays external -- consumers using
  // this from npm bring their own copy via their own bundler, and bundling
  // it here would duplicate it (and any Firebase app the researcher's page
  // already initialized) instead of sharing one.
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    platform: "neutral",
    dts: true,
    sourcemap: true,
    clean: true,
    outDir: "dist",
    external: ["firebase/app", "firebase/database"],
  },
  // Browser build: a single <script> tag, Firebase bundled in, exposing a
  // `DataPipe` global -- for the plain-JS researchers who have no bundler
  // and no npm.
  {
    entry: { "datapipe-client.browser": "src/index.ts" },
    format: ["iife"],
    globalName: "DataPipe",
    platform: "browser",
    minify: true,
    sourcemap: true,
    outDir: "dist",
    noExternal: [/.*/],
  },
]);
