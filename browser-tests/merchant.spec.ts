import { test, expect } from "@playwright/test";
test("merchant connects, retries with the same request, sees a completed model and attaches it", async ({
  page,
}) => {
  const keys: string[] = [];
  await page.route(
    "https://cdn.shopify.com/shopifycloud/app-bridge.js",
    (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `window.shopify={idToken:async()=> 'test-token',resourcePicker:async()=> [{id:'gid://shopify/Product/1',title:'Test product'}]};const originalFetch=window.fetch;window.fetch=(url,options)=>originalFetch(String(url).startsWith('shopify:admin/')?'https://shopify-mock.example.com/graphql':url,options);`,
      }),
  );
  await page.route(
    "https://cdn.shopify.com/shopifycloud/polaris-1.1.js",
    (route) =>
      route.fulfill({ contentType: "application/javascript", body: "" }),
  );
  const model = {
    id: "job-1",
    status: "SUCCESS",
    createdAt: "2026-10-05T12:00:00Z",
    outputGlbUrl: "https://models.example.com/job.glb",
    errorMessage: null,
  };
  let accepted = false;
  await page.route("https://api.example.com/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    };
    if (request.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    expect(request.headers().authorization).toBe("Bearer test-token");
    if (path.endsWith("/connection"))
      return route.fulfill({ json: {}, headers: cors });
    if (path.endsWith("/subscription"))
      return route.fulfill({
        json: {
          status: "ACTIVE",
          planName: "Starter",
          generationLimit: 10,
          generationsConsumed: accepted ? 1 : 0,
          pricingUrl:
            "https://admin.shopify.com/store/test/charges/3dify/pricing",
          periodEnd: "2027-10-05T00:00:00Z",
          allowancePeriodEnd: "2026-11-05T00:00:00Z",
        },
        headers: cors,
      });
    if (request.method() === "POST") {
      keys.push(request.headers()["idempotency-key"]);
      if (keys.length === 1)
        return route.fulfill({
          status: 503,
          json: { message: "Temporary failure" },
          headers: cors,
        });
      accepted = true;
      return route.fulfill({
        status: 202,
        json: { jobId: "job-1", status: "PENDING" },
        headers: cors,
      });
    }
    return route.fulfill({
      json: { models: accepted ? [model] : [], nextCursor: null },
      headers: cors,
    });
  });
  await page.route("https://models.example.com/**", (route) =>
    route.fulfill({
      body: Buffer.from([1, 2, 3]),
      headers: { "Access-Control-Allow-Origin": "*" },
    }),
  );
  await page.route("https://upload.example.com/**", (route) =>
    route.fulfill({
      status: 201,
      body: "",
      headers: { "Access-Control-Allow-Origin": "*" },
    }),
  );
  let mediaAttached = false;
  await page.route("https://shopify-mock.example.com/**", async (route) => {
    const request = route.request();
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
    };
    if (request.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    const query = request.postDataJSON().query;
    if (query.includes("mutation Attach")) mediaAttached = true;
    const data = query.includes("Existing")
      ? {
          product: {
            media: {
              nodes: mediaAttached
                ? [{ id: "media-1", alt: "3dify model job-1", status: "READY" }]
                : [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        }
      : query.includes("Stage")
        ? {
            stagedUploadsCreate: {
              stagedTargets: [
                {
                  url: "https://upload.example.com/file",
                  resourceUrl: "https://storage.example.com/file",
                  parameters: [{ name: "key", value: "model" }],
                },
              ],
              userErrors: [],
            },
          }
        : {
            productUpdate: {
              product: { id: "gid://shopify/Product/1", media: { nodes: [] } },
              userErrors: [],
            },
          };
    return route.fulfill({ json: { data }, headers: cors });
  });
  await page.goto("/");
  await expect(page.locator("#notice")).toHaveText("Store connected.");
  await expect(page.locator("#subscription")).toContainText("allowance renews");
  const image = {
    name: "product.png",
    mimeType: "image/png",
    buffer: Buffer.from([137, 80, 78, 71]),
  };
  await page.locator("input[name=image1]").setInputFiles(image);
  await page.locator("input[name=image2]").setInputFiles(image);
  await page.locator("#generate").click();
  await expect(page.locator("#notice")).toHaveText("Temporary failure");
  await expect(page.locator("input[name=image1]")).toBeDisabled();
  await page.locator("#generate").click();
  await expect(page.locator("#notice")).toContainText("Generation accepted");
  expect(keys[0]).toBe(keys[1]);
  await page.getByRole("button", { name: "Add to product" }).click();
  await expect(page.locator("#notice")).toContainText(
    "Model ready on Test product",
  );
  await expect(page.locator("input[name=image1]")).toBeEnabled();
});
