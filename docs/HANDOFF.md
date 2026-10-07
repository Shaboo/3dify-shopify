# Shopify app handover — 2026-10-07

The merchant app and product-page block support testing with backend local billing. The standalone website now provides a second generation test path independent of Shopify.

## Related repositories

- Backend: `/Users/shaboo/Documents/3dify` → `git@github.com:Shaboo/3dify.git`.
- Standalone website: `/Users/shaboo/Documents/3dify-fe` → `git@github.com:Shaboo/3dify-fe.git`.
- Shopify app: `/Users/shaboo/Documents/3dify-shopify` → `git@github.com:Shaboo/3dify-shopify.git`.

All use branch `main`. These handovers are persistent repository context, not automatic model memory. Read the other repos’ current handovers when changing contracts across projects.

## Current behavior

Merchant selects a saved product, chooses existing saved product photos or alternate uploads, then generates asynchronously. Backend attaches completed owned GLB output in the background, even after the app closes. The Preact admin block targets `admin.product-details.block.render`; merchants must add/pin **Generate 3D model**. New products must be saved first. Manual **Refresh** loads photos added/changed after saving; user accepts this for now. Do not promise automatic refresh.

Product image listing and product-bound image-ID/multipart submission are supported. Stable UUID retries and attachment status polling preserve backend idempotency. Generation-options comes from backend: Meshy 1–4 photos, existing RunPod worker 1–2; no global provider ceiling. Backend upload defaults are 20 MB/photo and 85 MB/request.

Subscription responses expose `localTesting`. Embedded app and product block display local test allowance and provider-cost notice; Manage plan is disabled in local testing. Real backend authentication, staff write permissions, quota accounting, outbox and background attachment still apply. Extension UID is retained in `shopify.extension.toml`.

## Billing and generation diagnostics

Real Partner billing remains blocked by app visibility under the configured organization and App Store registration/pricing access. The Partner organization billing token is separate from per-store encrypted offline access/refresh credentials. Current testing does not require paying the App Store registration fee.

Backend `shopify.billing-mode=local-test` works only when `local` is the sole active profile and the configured store ID/domain match. Current verified store: `3dify-test.myshopify.com`, Shop ID `85878767704`; allowance 10 generations per UTC calendar month, durably enforced. Internal test plan is inactive with no public offer. Default/production billing mode remains `shopify`. Real provider credits still apply.

Earlier UI showed **Attachment canceled / Generation failed or app disconnected** because generation failed, not because connection was confirmed lost. Backend cancellation now distinguishes generation failure, disconnection and changed installation. Meshy timeout is configurable (120 seconds locally) with safe HTTP/transport diagnostics. Original ~31-second failure cannot be conclusively attributed to timeout because the cause was discarded. User performs paid reproductions themselves; do not submit generation automatically.

Two later user tasks have acknowledged Meshy IDs but completion/automatic media attachment has not been verified. Mocked success is not live end-to-end proof.

## Run and preserve configuration

Start backend via IntelliJ **3dify Local**, then an HTTPS backend tunnel. Set public `VITE_BACKEND_URL` in the existing ignored environment file, allow required HTTPS app/extension origins in backend config, and run:

```sh
npm run sync:extension
shopify app dev --config 3dify-test
```

`extensions/product-model/src/backend-url.js` is generated/ignored. Preserve the current environment and dev URL. Never put credentials in VITE variables. Required scopes `read_products,write_products`; online Direct API enabled. Backend exchanges/refreshes encrypted offline credentials automatically; no manual store token copy is needed. Keep persistent backend AES key intact.

The standalone website at http://localhost:3000 needs no tunnel or Shopify origin. Website user/admin accounts and free plan are separate from Shopify store authentication and local allowance. See `../3dify-fe/docs/HANDOFF.md` locally.

## Validation and next steps

API tests/TypeScript/Vite build and mocked merchant browser workflows validate local billing notices and product generation behavior. Browser tests use isolated port 5178 and skip extension-config sync. Extension build was verified earlier; the current change adds its assigned UID and local testing notice. Full validation counts are recorded below. Production audit previously reported zero vulnerabilities; SDK development-tooling advisories were not fixed by unrelated major upgrades.

Next: user tests a live product-photo generation and follows provider status, then confirms automatic Shopify media READY including closing the app during processing. Test standalone generation separately. Real Shopify billing and live attachment remain unverified. No deployment/publication requested.

## Final verification before commit/push

2026-10-07: backend full suite passed **110 unit + 105 integration tests (215 total)** and Spotless/architecture checks. Shopify passed **12 API tests**, TypeScript/Vite production build, and **3 mocked browser workflows** on isolated port 5178. Standalone website previously passed **24 desktop/mobile/proxy checks**, TypeScript and production build. No paid provider submission, deployment or app publication was performed for these checks. All current work and handovers are being committed/pushed to `origin/main` at the user’s request.
