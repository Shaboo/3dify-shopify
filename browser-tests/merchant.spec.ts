import { test, expect } from "@playwright/test";

async function bridge(page: import("@playwright/test").Page) {
  await page.route(
    "https://cdn.shopify.com/shopifycloud/app-bridge.js",
    (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `window.shopify={idToken:async()=> 'test-token',resourcePicker:async()=> [{id:'gid://shopify/Product/1',title:'Test product'}]};`,
      }),
  );
  await page.route(
    "https://cdn.shopify.com/shopifycloud/polaris-1.1.js",
    (route) =>
      route.fulfill({ contentType: "application/javascript", body: "" }),
  );
}
const product = {
  id: "gid://shopify/Product/1",
  title: "Test product",
  images: Array.from({ length: 4 }, (_, i) => ({
    id: `gid://shopify/MediaImage/${i + 11}`,
    url: `https://cdn.shopify.com/test-${i}.png`,
    alt: `Angle ${i + 1}`,
  })),
};
const plan = {
  status: "ACTIVE",
  planName: "Starter",
  generationLimit: 10,
  generationsConsumed: 0,
  pricingUrl: "https://admin.shopify.com/store/test/charges/3dify/pricing",
};

test("merchant reuses product photos, retries the same request and sees automatic attachment after reopening", async ({
  page,
}) => {
  await bridge(page);
  const keys: string[] = [];
  let accepted = false;
  let attached = false;
  const model = () => ({
    id: "job-1",
    status: "SUCCESS",
    createdAt: "2026-10-05T12:00:00Z",
    outputGlbUrl: "https://models.example/job.glb",
    productId: product.id,
    attachmentStatus: attached ? "attached" : "processing",
    errorMessage: null,
  });
  await page.route("https://api.example.com/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    };
    if (request.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    expect(request.headers().authorization).toBe("Bearer test-token");
    if (path.endsWith("/connection"))
      return route.fulfill({ json: {}, headers });
    if (path.endsWith("/generation-options"))
      return route.fulfill({
        json: { provider: "meshy", minImages: 1, maxImages: 4 },
        headers,
      });
    if (path.endsWith("/subscription"))
      return route.fulfill({
        json: { ...plan, generationsConsumed: accepted ? 1 : 0 },
        headers,
      });
    if (path.endsWith("/images"))
      return route.fulfill({ json: product, headers });
    if (request.method() === "POST") {
      expect(path).toBe("/shopify/api/products/1/models");
      expect(request.postDataJSON()).toEqual({
        imageIds: product.images.map((p) => p.id),
      });
      keys.push(request.headers()["idempotency-key"]);
      if (keys.length === 1)
        return route.fulfill({
          status: 503,
          json: { message: "Temporary failure" },
          headers,
        });
      accepted = true;
      return route.fulfill({
        status: 202,
        json: { jobId: "job-1", status: "PENDING" },
        headers,
      });
    }
    return route.fulfill({
      json: path.endsWith("job-1")
        ? model()
        : { models: accepted ? [model()] : [], nextCursor: null },
      headers,
    });
  });
  await page.route("https://cdn.shopify.com/test-*.png", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    }),
  );
  await page.goto("/");
  await expect(page.locator("#notice")).toHaveText("Store connected.");
  await page.getByRole("button", { name: "Choose product" }).click();
  await expect(page.locator("#selected-product")).toHaveText("Test product");
  for (const checkbox of await page.locator("input[name=product-photo]").all())
    await checkbox.check();
  await page
    .getByRole("button", { name: "Generate model", exact: true })
    .click();
  await expect(page.locator("#notice")).toHaveText("Temporary failure");
  await expect(
    page.locator("input[name=product-photo]").first(),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Generate model", exact: true })
    .click();
  await expect(
    page.getByText("Shopify is processing the model", { exact: true }),
  ).toBeVisible();
  expect(keys[0]).toBe(keys[1]);
  expect(keys).toHaveLength(2);
  await expect(
    page.getByRole("button", { name: "Add to product" }),
  ).toHaveCount(0);
  attached = true;
  await page.reload();
  await expect(
    page.getByText("Attached to product", { exact: true }),
  ).toBeVisible();
  expect(keys).toHaveLength(2);
});

test("uploaded photos are bound to the chosen product and locked for retry", async ({
  page,
}) => {
  await bridge(page);
  const bodies: string[] = [];
  const keys: string[] = [];
  await page.route("https://api.example.com/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    };
    if (request.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    if (path.endsWith("/connection"))
      return route.fulfill({ json: {}, headers });
    if (path.endsWith("/generation-options"))
      return route.fulfill({
        json: { provider: "meshy", minImages: 1, maxImages: 4 },
        headers,
      });
    if (path.endsWith("/subscription"))
      return route.fulfill({ json: plan, headers });
    if (path.endsWith("/images"))
      return route.fulfill({ json: product, headers });
    if (request.method() === "POST") {
      expect(path).toBe("/shopify/api/models");
      const body = request.postData() || "";
      bodies.push(body);
      keys.push(request.headers()["idempotency-key"]);
      expect(body.match(/name="images"/g)).toHaveLength(4);
      expect(body).toContain('name="productId"');
      expect(body).toContain(product.id);
      return route.fulfill({
        status: 503,
        json: { message: "Temporary failure" },
        headers,
      });
    }
    return route.fulfill({ json: { models: [], nextCursor: null }, headers });
  });
  await page.goto("/");
  await expect(page.locator("#notice")).toHaveText("Store connected.");
  await page.getByRole("button", { name: "Choose product" }).click();
  await expect(page.locator("#selected-product")).toHaveText("Test product");
  await page.locator("#photo-source").selectOption("upload");
  await page.locator("input[name=images]").setInputFiles(
    Array.from({ length: 4 }, (_, i) => ({
      name: `${i}.png`,
      mimeType: "image/png",
      buffer: Buffer.from([1, 2, 3]),
    })),
  );
  await page
    .getByRole("button", { name: "Generate model", exact: true })
    .click();
  await expect(page.locator("#notice")).toHaveText("Temporary failure");
  await expect(page.locator("#choose-product")).toBeDisabled();
  await expect(page.locator("#photo-source")).toBeDisabled();
  await expect(page.locator("input[name=images]")).toBeDisabled();
  await page
    .getByRole("button", { name: "Generate model", exact: true })
    .click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[0]).toBe(keys[1]);
  await page.getByRole("button", { name: "Start a new request" }).click();
  await expect(page.locator("#choose-product")).toBeEnabled();
});

test("local billing shows its allowance, disables plan management and keeps product selection usable", async ({
  page,
}) => {
  await bridge(page);
  let localTesting = true;
  await page.route("https://api.example.com/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    };
    if (request.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    if (path.endsWith("/subscription"))
      return route.fulfill({
        json: {
          ...plan,
          localTesting,
          pricingUrl: localTesting ? "" : plan.pricingUrl,
          generationsConsumed: 3,
        },
        headers,
      });
    if (path.endsWith("/generation-options"))
      return route.fulfill({
        json: { provider: "meshy", minImages: 1, maxImages: 4 },
        headers,
      });
    if (path.endsWith("/images"))
      return route.fulfill({ json: product, headers });
    return route.fulfill({
      json: path.endsWith("/models") ? { models: [], nextCursor: null } : {},
      headers,
    });
  });
  await page.goto("/");
  await expect(page.locator("#notice")).toHaveText("Store connected.");
  await expect(page.locator("#billing-mode")).toBeVisible();
  await expect(page.locator("#billing-mode")).toContainText(
    "Local testing — Shopify billing disabled",
  );
  await expect(page.locator("#subscription")).toContainText(
    "3 / 10 generations used",
  );
  await expect(page.locator("#pricing")).toHaveAttribute("disabled", "");
  await page.getByRole("button", { name: "Choose product" }).click();
  await expect(page.locator("#selected-product")).toHaveText("Test product");
  localTesting = false;
  await page.locator("#refresh").click();
  await expect(page.locator("#billing-mode")).toBeHidden();
  await expect(page.locator("#pricing")).not.toHaveAttribute("disabled", "");
});
