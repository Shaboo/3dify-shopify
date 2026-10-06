import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Shopify CLI supplies the frontend tunnel URL; HOST supports older CLI versions.
  const appUrl = process.env.SHOPIFY_APP_URL || process.env.HOST || env.SHOPIFY_APP_URL;
  const tunnelHost = appUrl ? new URL(appUrl).hostname : undefined;

  return {
    server: {
      host: "0.0.0.0",
      port: Number(process.env.PORT || process.env.FRONTEND_PORT || 5173),
      strictPort: true,
      allowedHosts: [
        ...(tunnelHost ? [tunnelHost] : []),
        // Current dev session fallback when CLI does not supply its tunnel URL.
        "constantly-logged-stanley-toddler.trycloudflare.com",
      ],
      ...(tunnelHost && tunnelHost !== "localhost"
        ? { hmr: { protocol: "wss", host: tunnelHost, clientPort: 443 } }
        : {}),
    },
  };
});
