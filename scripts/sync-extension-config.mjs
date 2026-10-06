import { loadEnv } from "vite";
import { mkdirSync, writeFileSync } from "node:fs";
if (process.env.SKIP_EXTENSION_CONFIG_SYNC === "true") process.exit(0);
const settings = loadEnv(process.argv[2] || "development", process.cwd(), "VITE_");
const url = process.env.VITE_BACKEND_URL || settings.VITE_BACKEND_URL || "";
if (url && new URL(url).protocol !== "https:")
  throw new Error("The product extension backend must use HTTPS");
mkdirSync("extensions/product-model/src", { recursive: true });
writeFileSync(
  "extensions/product-model/src/backend-url.js",
  `// Generated from the existing public VITE_BACKEND_URL setting.\nexport const backendUrl = ${JSON.stringify(url)};\n`,
);
