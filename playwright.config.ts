import { defineConfig } from "@playwright/test";
const port = Number(process.env.PLAYWRIGHT_PORT || 5173);
export default defineConfig({
  testDir: "browser-tests",
  use: { baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    env: {
      SKIP_EXTENSION_CONFIG_SYNC: "true",
      VITE_SHOPIFY_API_KEY: "test-client-id",
      VITE_BACKEND_URL: "https://api.example.com",
    },
  },
});
