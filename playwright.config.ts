import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "browser-tests",
  use: { baseURL: "http://127.0.0.1:5173" },
  webServer: {
    command: "npm run dev -- --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    env: {
      VITE_SHOPIFY_API_KEY: "test-client-id",
      VITE_BACKEND_URL: "https://api.example.com",
    },
  },
});
