import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, "../..");
export const BASE_URL = (
  process.env.USER_FRONT_BASE_URL || "http://localhost:3000"
)
  .trim()
  .replace(/\/+$/, "");
export const TEST_ADDRESS = "0x82f1c188327bfc265357a85e8a6b4a34d562d6f8";
export const CHAIN_ID = 31337;
export const OUT_DIR = path.join(
  ROOT,
  "output/playwright/user-front-error-toasts",
  new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z")
);

export function ensureOutputDir() {
  mkdirSync(OUT_DIR, { recursive: true });
}

export function pageUrl(routePath) {
  return `${BASE_URL}${routePath}`;
}
