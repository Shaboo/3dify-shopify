# 3dify for Shopify

Embedded Shopify merchant app, separate from the Kotlin backend in `../3dify`. Uses current App Bridge, Polaris 1.1 web components, Shopify managed installation and online Direct Admin API access. No Shopify secret or Admin access token belongs in this frontend.

## Local setup

Use Node 22 or newer. Run `npm ci`, copy `.env.example` to `.env`, and fill in the **public** Shopify client ID and backend HTTPS URL. Run `npm run dev`. Open from the Shopify development store admin with the app configured to the HTTPS tunnel URL; standalone browser loading cannot authenticate.

Edit `shopify.app.toml`: real client ID, app URL and backend webhook URLs. Keep `embedded_app_direct_api_access = true`, online access and managed installation enabled. Install Shopify CLI separately if desired; `shopify app dev` uses `shopify.web.toml`. Shopify CLI config deploy publishes app configuration, not the Vite website.

The backend must enable Shopify, configure the same app ID/client ID/secret and Partner billing credentials, map real App Pricing offers, and allow this app's origin through CORS. Product scopes are `read_products,write_products`; backend installation queries shop identity. Mandatory privacy and uninstall topics route directly to the backend `/shopify/webhooks`.

## Merchant workflow

Connection is established with a fresh Shopify ID token. The plan view shows allowance usage and opens Shopify hosted App Pricing. Choose a saved Shopify product, select its existing photos or upload different ones, then generate. The backend automatically attaches the finished model, and the UI polls generation and attachment state. You may close the page while the job runs. The frontend loads photo-count limits from the authenticated backend `/shopify/api/generation-options` endpoint: Meshy accepts 1–4 photos, while other providers can declare a different limit or no limit. Retries within this page preserve the UUID and lock the selected files until accepted; changing inputs requires explicitly starting a new request. A page reload discards file selections and the pending request; check the model list before starting another request after an ambiguous network response.

For completed GLB output, select a product through App Bridge. The app checks existing product media for the job marker, downloads the GLB, requests a staged MODEL_3D upload, uploads its exact bytes, and calls `productUpdate` with media. The app polls Shopify media status sequentially for up to 55 seconds and reports READY or FAILED. If processing takes longer, select the same product again to resume checking; failed media must be removed in Shopify before retrying. Duplicate detection is best effort and is not atomic across simultaneous tabs. The model output host **must allow app-origin CORS**. The app never forwards backend tokens to model storage or Shopify upload hosts. USDZ remains available through the backend contract but GLB is the attachment format.

## Validation and deployment

`npm run check` runs boundary tests and TypeScript/Vite production build. After `npx playwright install chromium`, run `npm run test:browser` for the mocked browser merchant workflow. GitHub Actions runs both. Host `dist/` on HTTPS with SPA index fallback, and configure `Content-Security-Policy: frame-ancestors https://admin.shopify.com https://*.myshopify.com;` on HTML responses. Avoid `X-Frame-Options: DENY/SAMEORIGIN`. Configure real app and backend URLs before launch. There is no chosen production hosting provider or live credential material in this repository.

Live validation still needs Shopify credentials and development store: managed installation/token exchange, hosted pricing return, backend CORS, model-source CORS, scopes, staged-upload acceptance and Shopify media processing, uninstall and privacy webhook delivery. See [session handoff](docs/HANDOFF.md).

## Official references

- [App Bridge resource fetching and Direct API access](https://shopify.dev/docs/api/app-home/v1.0/apis/authentication-and-data/resource-fetching-api)
- [App configuration](https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration)
- [Polaris 1.1 stable CDN](https://shopify.dev/changelog/posts/polaris-cdn-1-1-is-now-stable)
- [Staged uploads](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/stagedUploadsCreate)
- [Product media update](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/productUpdate)

## Product-page panel

The `extensions/product-model` admin block targets `admin.product-details.block.render`. Restart `shopify app dev --config 3dify-test` after adding the extension, open a saved product on the test store, and add/pin the **Generate 3D model** app block. The block selects existing product photos and displays background attachment progress. New products must be saved first.

The extension uses the same public `VITE_BACKEND_URL` as the embedded app. `npm run dev`, `npm run build`, and installation synchronize it into an ignored generated module; no additional environment variable export is required. When the backend tunnel changes, update `.env.local` and restart development. Build verification: `npm run check`, `PLAYWRIGHT_PORT=5178 npm run test:browser`, and `shopify app build --config 3dify-test`. Local builds do not deploy the extension.

Automatic attachment needs the backend's encrypted offline credential store and scheduled worker. The backend obtains and refreshes store tokens itself. Keep `read_products,write_products` in the app scopes and grant them in the test store. The Partner organization token is only used for billing.

The production bundle includes Preact and the Shopify signal adapter. The Shopify SDK is a development dependency; its documentation-generation dependencies currently report npm audit advisories. `npm audit --omit=dev` reports no production vulnerabilities. Avoid forcing a downgrade to an older Shopify extension API to silence those tooling advisories.
