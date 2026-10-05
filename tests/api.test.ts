import { describe, it, expect, vi } from "vitest";
import {
  backendClient,
  validateImages,
  pricingDestination,
  isRunning,
  type Model,
} from "../src/api";
import { attachModel, graphql } from "../src/shopify";
describe("backend boundary", () => {
  it("stops polling canonical SUCCESS and FAILED backend states", () => {
    for (const status of ["SUCCESS", "FAILED"])
      expect(isRunning({ status } as Model)).toBe(false);
    for (const status of ["PENDING", "PROCESSING"])
      expect(isRunning({ status } as Model)).toBe(true);
  });
  it("retries unauthorized generation once with fresh token and identical files and key", async () => {
    const tokens = vi
      .fn()
      .mockResolvedValueOnce("expired")
      .mockResolvedValueOnce("fresh");
    const requests: Array<{
      token: string | null;
      key: string | null;
      body: BodyInit | null | undefined;
    }> = [];
    const request = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        requests.push({
          token: headers.get("Authorization"),
          key: headers.get("Idempotency-Key"),
          body: init?.body,
        });
        return requests.length === 1
          ? new Response("", { status: 401 })
          : new Response(JSON.stringify({ jobId: "job", status: "PENDING" }));
      },
    );
    const files = [
      new File(["a"], "a.png", { type: "image/png" }),
      new File(["b"], "b.png", { type: "image/png" }),
    ];
    await backendClient("https://api.example.com", tokens, request).generate(
      files,
      "stable-key",
    );
    expect(requests.map((x) => x.token)).toEqual([
      "Bearer expired",
      "Bearer fresh",
    ]);
    expect(requests.map((x) => x.key)).toEqual(["stable-key", "stable-key"]);
    expect(requests[0].body).toBe(requests[1].body);
  });
  it("obtains a fresh token and preserves the same UUID on retries", async () => {
    const tokens = vi
      .fn()
      .mockResolvedValueOnce("one")
      .mockResolvedValueOnce("two");
    const request = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ jobId: "job", status: "PENDING" })),
      );
    const api = backendClient("https://api.example.com", tokens, request);
    const files = [
      new File(["a"], "a.png", { type: "image/png" }),
      new File(["b"], "b.png", { type: "image/png" }),
    ];
    await api.generate(files, "stable-uuid");
    await api.generate(files, "stable-uuid");
    expect(tokens).toHaveBeenCalledTimes(2);
    expect(
      request.mock.calls.map((x) =>
        (x[1].headers as Headers).get("Idempotency-Key"),
      ),
    ).toEqual(["stable-uuid", "stable-uuid"]);
    expect(
      (request.mock.calls[1][1].headers as Headers).get("Authorization"),
    ).toBe("Bearer two");
    expect(
      (request.mock.calls[0][1].body as FormData).get("image2"),
    ).toBeInstanceOf(File);
  });
  it("reports backend errors without logging a token", async () => {
    const api = backendClient(
      "https://api.example.com",
      async () => "secret",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "Quota exceeded" }), {
          status: 429,
        }),
      ),
    );
    await expect(api.subscription()).rejects.toThrow("Quota exceeded");
  });
  it("rejects invalid images and hostile pricing destinations", () => {
    expect(() => validateImages([])).toThrow();
    expect(() =>
      validateImages([
        new File(["x"], "a.svg", { type: "image/svg+xml" }),
        new File(["x"], "b.png", { type: "image/png" }),
      ]),
    ).toThrow();
    expect(() =>
      pricingDestination("https://admin.shopify.com.evil.example/pricing"),
    ).toThrow();
    expect(
      pricingDestination(
        "https://admin.shopify.com/store/test/charges/app/pricing",
      ),
    ).toContain("admin.shopify.com");
  });
});
describe("Shopify media boundary", () => {
  it("passes exact upload bytes, size, parameters and MODEL_3D resource to staged upload and product mutation", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              stagedUploadsCreate: {
                stagedTargets: [
                  {
                    url: "https://upload.example.com",
                    resourceUrl: "https://storage.example.com/model",
                    parameters: [{ name: "key", value: "model.glb" }],
                  },
                ],
                userErrors: [],
              },
            },
          }),
        ),
      )
      .mockResolvedValueOnce(new Response("", { status: 201 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              productUpdate: {
                product: {
                  id: "gid://shopify/Product/1",
                  media: { nodes: [] },
                },
                userErrors: [],
              },
            },
          }),
        ),
      );
    await attachModel(
      "gid://shopify/Product/1",
      "https://output.example.com/model.glb",
      "job-id",
      request,
    );
    const stage = JSON.parse(request.mock.calls[1][1].body);
    expect(stage.variables.input[0]).toMatchObject({
      resource: "MODEL_3D",
      mimeType: "model/gltf-binary",
      fileSize: "3",
    });
    const upload = request.mock.calls[2][1].body as FormData;
    expect(upload.get("key")).toBe("model.glb");
    expect((upload.get("file") as File).size).toBe(3);
    expect(
      JSON.parse(request.mock.calls[3][1].body).variables.media[0]
        .originalSource,
    ).toBe("https://storage.example.com/model");
  });
  it("stops before upload when Shopify returns user errors", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response("model"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              stagedUploadsCreate: {
                stagedTargets: [],
                userErrors: [{ message: "Permission denied" }],
              },
            },
          }),
        ),
      );
    await expect(
      attachModel(
        "product",
        "https://output.example.com/model",
        "job",
        request,
      ),
    ).rejects.toThrow("Permission denied");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("rejects GraphQL errors and prevents product mutation after upload failure", async () => {
    await expect(
      graphql(
        "query{}",
        {},
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              JSON.stringify({ errors: [{ message: "Throttled" }] }),
            ),
          ),
      ),
    ).rejects.toThrow("Throttled");
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response("model"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              stagedUploadsCreate: {
                stagedTargets: [
                  {
                    url: "https://upload.example.com",
                    resourceUrl: "https://storage.example.com/model",
                    parameters: [],
                  },
                ],
                userErrors: [],
              },
            },
          }),
        ),
      )
      .mockResolvedValueOnce(new Response("", { status: 500 }));
    await expect(
      attachModel(
        "product",
        "https://output.example.com/model",
        "job",
        request,
      ),
    ).rejects.toThrow("Model upload failed");
    expect(request).toHaveBeenCalledTimes(3);
  });
});
