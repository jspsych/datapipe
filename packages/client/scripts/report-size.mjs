// Reports the gzipped size of the browser IIFE bundle (dist/*.global.js),
// which is what a plain-JS researcher's page actually downloads via
// <script src=...>. Run after `npm run build`.

import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const distDir = new URL("../dist/", import.meta.url).pathname;
const files = readdirSync(distDir).filter((f) => f.includes("browser") && f.endsWith(".js"));

if (files.length === 0) {
  console.error("No browser bundle found in dist/. Run `npm run build` first.");
  process.exit(1);
}

for (const file of files) {
  const path = join(distDir, file);
  const raw = readFileSync(path);
  const gzipped = gzipSync(raw);
  console.log(
    `${file}: ${(raw.length / 1024).toFixed(1)} KB raw, ${(gzipped.length / 1024).toFixed(1)} KB gzipped`
  );
}
