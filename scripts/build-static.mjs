import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "dist");

const entries = [
  "index.html",
  "styles.css",
  "app.js",
  "sw.js",
  "data",
  "public"
];

mkdirSync(outDir, { recursive: true });

for (const entry of entries) {
  cpSync(join(root, entry), join(outDir, entry), {
    recursive: true,
    force: true
  });
}
